package cancelregistry

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestRegisterAndCancelInvokesFunc(t *testing.T) {
	r := New()
	var cancelled bool
	r.Register("req-1", func() { cancelled = true })

	if ok := r.Cancel("req-1"); !ok {
		t.Fatalf("Cancel() = false, want true")
	}
	if !cancelled {
		t.Fatalf("cancel func was not invoked")
	}
	if got := r.Len(); got != 0 {
		t.Fatalf("Len() after cancel = %d, want 0", got)
	}
}

func TestCancelUnknownIDIsNoop(t *testing.T) {
	r := New()
	if ok := r.Cancel("does-not-exist"); ok {
		t.Fatalf("Cancel() for unknown id = true, want false")
	}
}

func TestCancelEmptyIDIsNoop(t *testing.T) {
	r := New()
	called := false
	r.Register("", func() { called = true })
	if ok := r.Cancel(""); ok {
		t.Fatalf("Cancel(\"\") = true, want false")
	}
	if called {
		t.Fatalf("empty id should never be registered")
	}
	if got := r.Len(); got != 0 {
		t.Fatalf("Len() = %d, want 0", got)
	}
}

func TestRegisterNilCancelIsNoop(t *testing.T) {
	r := New()
	r.Register("req-1", nil)
	if got := r.Len(); got != 0 {
		t.Fatalf("Len() = %d, want 0", got)
	}
}

func TestClearRemovesWithoutInvoking(t *testing.T) {
	r := New()
	var cancelled bool
	r.Register("req-1", func() { cancelled = true })

	r.Clear("req-1")

	if cancelled {
		t.Fatalf("Clear() must not invoke the cancel func")
	}
	if ok := r.Cancel("req-1"); ok {
		t.Fatalf("Cancel() after Clear() = true, want false (already removed)")
	}
}

func TestClearEmptyIDIsNoop(t *testing.T) {
	r := New()
	r.Clear("") // must not panic
}

func TestRegisterReplacesWithoutInvokingPrevious(t *testing.T) {
	r := New()
	var firstCancelled, secondCancelled bool
	r.Register("req-1", func() { firstCancelled = true })
	r.Register("req-1", func() { secondCancelled = true })

	r.Cancel("req-1")

	if firstCancelled {
		t.Fatalf("first cancel func was invoked; replacement should discard it silently")
	}
	if !secondCancelled {
		t.Fatalf("second (current) cancel func was not invoked")
	}
}

func TestTrackCancelsContextAndCleansUpOnRelease(t *testing.T) {
	r := New()
	ctx, release := r.Track(context.Background(), "req-1")

	if got := r.Len(); got != 1 {
		t.Fatalf("Len() after Track = %d, want 1", got)
	}
	select {
	case <-ctx.Done():
		t.Fatalf("context should not be done before release/cancel")
	default:
	}

	release()

	select {
	case <-ctx.Done():
	default:
		t.Fatalf("context should be done after release()")
	}
	if got := r.Len(); got != 0 {
		t.Fatalf("Len() after release = %d, want 0 (cleanup guaranteed)", got)
	}

	// release must be idempotent/safe to call multiple times (e.g. deferred
	// alongside an explicit early release, or after external Cancel).
	release()
}

func TestTrackContextCancelledExternallyViaCancel(t *testing.T) {
	r := New()
	ctx, release := r.Track(context.Background(), "req-1")
	defer release()

	if ok := r.Cancel("req-1"); !ok {
		t.Fatalf("Cancel() = false, want true")
	}

	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatalf("context was not cancelled by Cancel()")
	}
	if got := r.Len(); got != 0 {
		t.Fatalf("Len() after external Cancel = %d, want 0", got)
	}
}

func TestTrackEmptyIDStillReturnsUsableContext(t *testing.T) {
	r := New()
	ctx, release := r.Track(context.Background(), "")
	defer release()

	if got := r.Len(); got != 0 {
		t.Fatalf("Len() = %d, want 0 for empty id", got)
	}
	release()
	select {
	case <-ctx.Done():
	default:
		t.Fatalf("context should still be cancelled by release() even with empty id")
	}
}

// TestRegistryConcurrentAccess exercises Register/Clear/Cancel/Track/Len
// concurrently across many goroutines and IDs to catch data races (run with
// -race) and ensure the registry never panics or deadlocks under
// contention.
func TestRegistryConcurrentAccess(t *testing.T) {
	r := New()
	const goroutines = 50
	const iterations = 200

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				id := idFor(g, i)
				switch i % 4 {
				case 0:
					_, release := r.Track(context.Background(), id)
					release()
				case 1:
					r.Register(id, func() {})
					r.Clear(id)
				case 2:
					r.Register(id, func() {})
					r.Cancel(id)
				default:
					r.Cancel(id)
					_ = r.Len()
				}
			}
		}(g)
	}
	wg.Wait()

	if got := r.Len(); got != 0 {
		t.Fatalf("Len() after concurrent stress = %d, want 0 (all ids cleaned up)", got)
	}
}

func idFor(g, i int) string {
	return "req-" + string(rune('a'+g%26)) + "-" + string(rune('0'+i%10))
}
