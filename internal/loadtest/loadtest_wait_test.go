package loadtest

import (
	"context"
	"testing"
	"time"
)

func TestWaitOrStop_ReturnsTrueWhenDurationNonPositive(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopCh := make(chan struct{})
	if !WaitOrStop(ctx, stopCh, 0, nil) {
		t.Fatalf("expected true")
	}
	if !WaitOrStop(ctx, stopCh, -1, nil) {
		t.Fatalf("expected true")
	}
}

func TestWaitOrStop_StopsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stopCh := make(chan struct{})
	after := func(time.Duration) <-chan time.Time {
		ch := make(chan time.Time)
		return ch
	}
	if WaitOrStop(ctx, stopCh, time.Second, after) {
		t.Fatalf("expected false")
	}
}

func TestWaitOrStop_StopsOnStopChClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopCh := make(chan struct{})
	close(stopCh)
	after := func(time.Duration) <-chan time.Time {
		ch := make(chan time.Time)
		return ch
	}
	if WaitOrStop(ctx, stopCh, time.Second, after) {
		t.Fatalf("expected false")
	}
}

func TestWaitOrStop_ReturnsTrueWhenTimerFires(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopCh := make(chan struct{})
	fired := make(chan time.Time, 1)
	fired <- time.Unix(0, 0)
	after := func(time.Duration) <-chan time.Time {
		return fired
	}
	if !WaitOrStop(ctx, stopCh, time.Second, after) {
		t.Fatalf("expected true")
	}
}
