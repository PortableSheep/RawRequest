package loadtest

import "strconv"

const minFailureRateAbortSamples int64 = 20

func FailureRateAbortDecision(totalSent, failedSent int64, threshold float64, hasThreshold bool) (abort bool, reason string) {
	if !hasThreshold {
		return false, ""
	}
	if totalSent < minFailureRateAbortSamples || totalSent <= 0 {
		return false, ""
	}
	rate := float64(failedSent) / float64(totalSent)
	if rate >= threshold {
		return true, "Failure rate " + strconv.FormatFloat(rate*100, 'f', 1, 64) + "% exceeded threshold " + strconv.FormatFloat(threshold*100, 'f', 1, 64) + "%"
	}
	return false, ""
}
