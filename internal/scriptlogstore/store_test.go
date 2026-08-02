package scriptlogstore

import (
	"sync"
	"testing"
	"time"
)

func TestAppendTrimsAndNormalizes(t *testing.T) {
	s := New(10)
	entry, ok := s.Append("INFO", "", "  hello world  ")
	if !ok {
		t.Fatalf("Append() ok = false, want true")
	}
	if entry.Message != "hello world" {
		t.Fatalf("Message = %q, want trimmed %q", entry.Message, "hello world")
	}
	if entry.Level != "info" {
		t.Fatalf("Level = %q, want lowercased %q", entry.Level, "info")
	}
	if entry.Source != "script" {
		t.Fatalf("Source = %q, want default %q", entry.Source, "script")
	}
	if _, err := time.Parse(time.RFC3339Nano, entry.Timestamp); err != nil {
		t.Fatalf("Timestamp = %q not RFC3339Nano: %v", entry.Timestamp, err)
	}
}

func TestAppendBlankMessageIsDropped(t *testing.T) {
	s := New(10)
	entry, ok := s.Append("info", "test", "   ")
	if ok {
		t.Fatalf("Append() ok = true for blank message, want false")
	}
	if entry != (Entry{}) {
		t.Fatalf("Append() entry = %+v, want zero value", entry)
	}
	if items := s.Items(); len(items) != 0 {
		t.Fatalf("Items() = %v, want empty after blank append", items)
	}
}

func TestAppendPreservesExplicitSource(t *testing.T) {
	s := New(10)
	entry, ok := s.Append("error", "pre-request", "boom")
	if !ok {
		t.Fatalf("Append() ok = false, want true")
	}
	if entry.Source != "pre-request" {
		t.Fatalf("Source = %q, want %q", entry.Source, "pre-request")
	}
	if entry.Level != "error" {
		t.Fatalf("Level = %q, want %q", entry.Level, "error")
	}
}

func TestItemsReturnsSnapshotCopy(t *testing.T) {
	s := New(10)
	s.Append("info", "test", "one")

	items := s.Items()
	items[0].Message = "mutated"

	items2 := s.Items()
	if items2[0].Message != "one" {
		t.Fatalf("store was mutated via returned snapshot: got %q", items2[0].Message)
	}
}

func TestBoundedCapacityDropsOldest(t *testing.T) {
	s := New(2)
	s.Append("info", "t", "one")
	s.Append("info", "t", "two")
	s.Append("info", "t", "three")

	items := s.Items()
	if len(items) != 2 {
		t.Fatalf("Items() len = %d, want 2", len(items))
	}
	if items[0].Message != "two" || items[1].Message != "three" {
		t.Fatalf("Items() = %+v, want [two three]", items)
	}
}

func TestClearRemovesAllEntries(t *testing.T) {
	s := New(10)
	s.Append("info", "t", "one")
	s.Clear()

	if items := s.Items(); len(items) != 0 {
		t.Fatalf("Items() after Clear() = %v, want empty", items)
	}
}

// TestStoreConcurrentAccess exercises Append/Items/Clear concurrently to
// catch data races (run with -race) and confirm the store never panics
// under contention.
func TestStoreConcurrentAccess(t *testing.T) {
	s := New(50)
	const goroutines = 50
	const iterations = 200

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				switch i % 3 {
				case 0:
					s.Append("info", "worker", "message")
				case 1:
					_ = s.Items()
				default:
					s.Clear()
				}
			}
		}(g)
	}
	wg.Wait()

	// Final sanity check: Items() must still work without panicking and
	// respect the configured capacity.
	if items := s.Items(); len(items) > 50 {
		t.Fatalf("Items() len = %d, want <= capacity 50", len(items))
	}
}

func TestAppendUsesInjectedClock(t *testing.T) {
	s := New(10)
	fixed := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	s.now = func() time.Time { return fixed }

	entry, ok := s.Append("info", "t", "msg")
	if !ok {
		t.Fatalf("Append() ok = false, want true")
	}
	want := fixed.UTC().Format(time.RFC3339Nano)
	if entry.Timestamp != want {
		t.Fatalf("Timestamp = %q, want %q", entry.Timestamp, want)
	}
}

func TestNewCapacityZeroRetainsNothing(t *testing.T) {
	s := New(0)
	s.Append("info", "t", "msg")
	if items := s.Items(); len(items) != 0 {
		t.Fatalf("Items() = %v, want empty for zero-capacity store", items)
	}
}
