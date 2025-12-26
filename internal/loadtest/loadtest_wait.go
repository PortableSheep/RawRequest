package loadtest

import (
	"context"
	"time"
)

type afterFunc func(time.Duration) <-chan time.Time

func WaitOrStop(ctx context.Context, stopCh <-chan struct{}, d time.Duration, after afterFunc) bool {
	if d <= 0 {
		return true
	}
	if after == nil {
		after = time.After
	}
	select {
	case <-ctx.Done():
		return false
	case <-stopCh:
		return false
	case <-after(d):
		return true
	}
}
