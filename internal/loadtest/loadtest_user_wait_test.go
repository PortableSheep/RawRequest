package loadtest

import (
	"testing"
	"time"
)

type fakeInt63n struct {
	values []int64
	i      int
}

func (f *fakeInt63n) Int63n(n int64) int64 {
	if n <= 0 {
		return 0
	}
	if len(f.values) == 0 {
		return 0
	}
	v := f.values[f.i%len(f.values)]
	f.i++
	if v < 0 {
		v = -v
	}
	return v % n
}

func TestUserWaitDuration_UsesDelayWhenNoRange(t *testing.T) {
	got := UserWaitDuration(false, 0, 0, 250, nil)
	if got != 250*time.Millisecond {
		t.Fatalf("expected 250ms, got %v", got)
	}
}

func TestUserWaitDuration_RangeSwapsMinMax(t *testing.T) {
	rng := &fakeInt63n{values: []int64{0}}
	got := UserWaitDuration(true, 500, 100, 0, rng)
	if got != 100*time.Millisecond {
		t.Fatalf("expected 100ms after swap, got %v", got)
	}
}

func TestUserWaitDuration_RangeEqualReturnsMin(t *testing.T) {
	rng := &fakeInt63n{values: []int64{999}}
	got := UserWaitDuration(true, 123, 123, 0, rng)
	if got != 123*time.Millisecond {
		t.Fatalf("expected 123ms, got %v", got)
	}
}

func TestUserWaitDuration_RangeInclusiveSampling(t *testing.T) {
	rng := &fakeInt63n{values: []int64{0, 1, 2}}
	min := int64(10)
	max := int64(12)

	w0 := UserWaitDuration(true, min, max, 0, rng)
	w1 := UserWaitDuration(true, min, max, 0, rng)
	w2 := UserWaitDuration(true, min, max, 0, rng)

	if w0 != 10*time.Millisecond || w1 != 11*time.Millisecond || w2 != 12*time.Millisecond {
		t.Fatalf("expected 10/11/12ms, got %v/%v/%v", w0, w1, w2)
	}
}

func TestUserWaitDuration_NonPositiveReturnsZero(t *testing.T) {
	if got := UserWaitDuration(false, 0, 0, -5, nil); got != 0 {
		t.Fatalf("expected 0, got %v", got)
	}
	if got := UserWaitDuration(true, -5, -1, 0, &fakeInt63n{values: []int64{0}}); got != 0 {
		t.Fatalf("expected 0, got %v", got)
	}
}
