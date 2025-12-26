package loadtest

import "math"

func DeriveSpawnRate(existing int64, hasExisting bool, hasRampUp bool, rampUpMs int64, remainingUsers int64) (spawnRate int64, hasSpawnRate bool) {
	spawnRate = existing
	hasSpawnRate = hasExisting

	if hasSpawnRate {
		return spawnRate, hasSpawnRate
	}
	if !hasRampUp || remainingUsers <= 0 {
		return spawnRate, hasSpawnRate
	}
	seconds := float64(rampUpMs) / 1000
	if seconds <= 0 {
		return spawnRate, hasSpawnRate
	}
	spawnRate = int64(math.Ceil(float64(remainingUsers) / seconds))
	if spawnRate < 1 {
		spawnRate = 1
	}
	return spawnRate, true
}
