package loadtestrunlogic

import (
	"testing"
	"time"
)

func TestComputeSpawnInterval(t *testing.T) {
	cases := []struct {
		name      string
		spawnRate int64
		want      time.Duration
	}{
		{"non-positive returns 0", 0, 0},
		{"negative returns 0", -1, 0},
		{"1 rps", 1, time.Second},
		{"2 rps", 2, 500 * time.Millisecond},
		{"clamps to 1ms", 10_000, time.Millisecond},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ComputeSpawnInterval(tc.spawnRate)
			if got != tc.want {
				t.Fatalf("ComputeSpawnInterval(%v)=%v want %v", tc.spawnRate, got, tc.want)
			}
		})
	}
}
