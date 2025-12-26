package loadtest

import (
	"sync"
	"time"
)

type AdaptiveWindowRing struct {
	enabled   bool
	windowSec int64
	ring      []adaptiveWindowBucket
	mu        sync.Mutex
}

type adaptiveWindowBucket struct {
	sec    int64
	sent   int64
	failed int64
}

func NewAdaptiveWindowRing(enabled bool, windowSec int64) *AdaptiveWindowRing {
	w := maxInt64(3, windowSec)
	return &AdaptiveWindowRing{
		enabled:   enabled,
		windowSec: w,
		ring:      make([]adaptiveWindowBucket, w+2),
	}
}

func (r *AdaptiveWindowRing) Record(now time.Time, isFailure bool) {
	if r == nil || !r.enabled {
		return
	}
	sec := now.Unix()
	idx := sec % int64(len(r.ring))
	r.mu.Lock()
	b := &r.ring[idx]
	if b.sec != sec {
		b.sec = sec
		b.sent = 0
		b.failed = 0
	}
	b.sent++
	if isFailure {
		b.failed++
	}
	r.mu.Unlock()
}

func (r *AdaptiveWindowRing) Stats(now time.Time) (sent, failed int64, failureRate *float64, rps *float64) {
	if r == nil || !r.enabled {
		return 0, 0, nil, nil
	}
	nowSec := now.Unix()
	minSec := nowSec - r.windowSec + 1
	var s int64
	var f int64
	r.mu.Lock()
	for i := range r.ring {
		b := r.ring[i]
		if b.sec >= minSec && b.sec <= nowSec {
			s += b.sent
			f += b.failed
		}
	}
	r.mu.Unlock()
	if s <= 0 {
		return 0, 0, nil, nil
	}
	fr := float64(f) / float64(s)
	rv := float64(s) / float64(r.windowSec)
	return s, f, &fr, &rv
}
