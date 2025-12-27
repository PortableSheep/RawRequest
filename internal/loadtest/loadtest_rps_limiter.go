package loadtest

import (
	"sync"
	"time"
)

type RpsLimiter struct {
	interval    time.Duration
	nextAllowed time.Time
	mu          sync.Mutex
}

func NewRpsLimiter(start time.Time, rps int64) *RpsLimiter {
	if rps <= 0 {
		return nil
	}
	interval := time.Duration(float64(time.Second) / float64(rps))
	if interval <= 0 {
		interval = time.Nanosecond
	}
	return &RpsLimiter{interval: interval, nextAllowed: start}
}

func (l *RpsLimiter) Reserve(now time.Time) time.Duration {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	wait := l.nextAllowed.Sub(now)
	if wait < 0 {
		wait = 0
	}
	if now.After(l.nextAllowed) {
		l.nextAllowed = now
	}
	l.nextAllowed = l.nextAllowed.Add(l.interval)
	l.mu.Unlock()
	return wait
}
