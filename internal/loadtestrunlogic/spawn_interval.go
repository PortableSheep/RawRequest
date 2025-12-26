package loadtestrunlogic

import "time"

// ComputeSpawnInterval converts a spawn rate (users per second) to a scheduling interval.
// Returns 0 when spawnRate <= 0. Clamps the minimum interval to 1ms.
func ComputeSpawnInterval(spawnRate int64) time.Duration {
	if spawnRate <= 0 {
		return 0
	}
	interval := time.Second / time.Duration(spawnRate)
	if interval < time.Millisecond {
		return time.Millisecond
	}
	return interval
}
