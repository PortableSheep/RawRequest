package loadtest

import "time"

type int63nSource interface {
	Int63n(n int64) int64
}

func UserWaitDuration(hasWaitRange bool, waitMinMs, waitMaxMs, delayMs int64, rng int63nSource) time.Duration {
	if hasWaitRange {
		min := waitMinMs
		max := waitMaxMs
		if max < min {
			min, max = max, min
		}
		if max <= min {
			if min <= 0 {
				return 0
			}
			return time.Duration(min) * time.Millisecond
		}
		rangeMs := (max - min) + 1
		if rng == nil || rangeMs <= 0 {
			return time.Duration(min) * time.Millisecond
		}
		v := min + rng.Int63n(rangeMs)
		if v <= 0 {
			return 0
		}
		return time.Duration(v) * time.Millisecond
	}

	if delayMs <= 0 {
		return 0
	}
	return time.Duration(delayMs) * time.Millisecond
}
