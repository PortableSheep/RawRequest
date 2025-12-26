package loadtest

import (
	"testing"
	"time"
)

func TestRpsLimiter_ReserveSpacing(t *testing.T) {
	start := time.Unix(1000, 0)
	l := NewRpsLimiter(start, 2) // 2 rps => 500ms
	if l == nil {
		t.Fatalf("expected limiter")
	}

	w0 := l.Reserve(start)
	if w0 != 0 {
		t.Fatalf("expected first wait 0, got %v", w0)
	}

	// Immediately again at same time should require waiting ~500ms.
	w1 := l.Reserve(start)
	if w1 != 500*time.Millisecond {
		t.Fatalf("expected wait 500ms, got %v", w1)
	}

	// Because we reserved twice at the same instant, the next slot is now at +1s.
	// If time advanced by 200ms, remaining wait should be 800ms.
	w2 := l.Reserve(start.Add(200 * time.Millisecond))
	if w2 != 800*time.Millisecond {
		t.Fatalf("expected wait 800ms, got %v", w2)
	}

	// If time advanced beyond nextAllowed, wait resets to 0.
	w3 := l.Reserve(start.Add(2 * time.Second))
	if w3 != 0 {
		t.Fatalf("expected wait 0 when behind schedule, got %v", w3)
	}
}

func TestRpsLimiter_ReserveSingleCallRemainingWait(t *testing.T) {
	start := time.Unix(1000, 0)
	l := NewRpsLimiter(start, 2) // 2 rps => 500ms

	_ = l.Reserve(start)
	w := l.Reserve(start.Add(200 * time.Millisecond))
	if w != 300*time.Millisecond {
		t.Fatalf("expected wait 300ms, got %v", w)
	}
}

func TestRpsLimiter_NewWithZeroRpsIsNil(t *testing.T) {
	if NewRpsLimiter(time.Unix(0, 0), 0) != nil {
		t.Fatalf("expected nil limiter")
	}
}
