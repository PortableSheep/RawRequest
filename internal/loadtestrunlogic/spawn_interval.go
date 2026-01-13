package loadtestrunlogic

import "time"

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
