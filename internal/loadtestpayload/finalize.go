package loadtestpayload

import (
	"context"
	"sync"
	"sync/atomic"

	lt "rawrequest/internal/loadtest"
)

func copyStatusCounts(statusMu *sync.Mutex, statusCounts map[string]int64) map[string]int64 {
	statusMu.Lock()
	defer statusMu.Unlock()
	countsCopy := make(map[string]int64, len(statusCounts))
	for k, v := range statusCounts {
		countsCopy[k] = v
	}
	return countsCopy
}

func copyResponseTimes(rtMu *sync.Mutex, responseTimes []int64) []int64 {
	rtMu.Lock()
	defer rtMu.Unlock()
	return append([]int64(nil), responseTimes...)
}

type FinalizeInput struct {
	Ctx               context.Context
	StartMs           int64
	EndMs             int64
	PlannedDurationMs *int64
	Adaptive          *lt.AdaptiveSummary
	Aborted           *atomic.Bool
	AbortReason       *atomic.Value
	TotalSent         *atomic.Int64
	OkSent            *atomic.Int64
	FailedSent        *atomic.Int64
	Cancelled         bool
	StatusMu          *sync.Mutex
	StatusCounts      map[string]int64
	RtMu              *sync.Mutex
	ResponseTimes     []int64
}

func BuildResults(in FinalizeInput) Results {
	return Results{
		TotalRequests:       in.TotalSent.Load(),
		SuccessfulRequests:  in.OkSent.Load(),
		FailedRequests:      in.FailedSent.Load(),
		FailureStatusCounts: copyStatusCounts(in.StatusMu, in.StatusCounts),
		ResponseTimesMs:     copyResponseTimes(in.RtMu, in.ResponseTimes),
		StartTimeMs:         in.StartMs,
		EndTimeMs:           in.EndMs,
		Cancelled:           in.Cancelled && in.Ctx.Err() == context.Canceled && !in.Aborted.Load(),
		Aborted:             in.Aborted.Load(),
		AbortReason:         in.AbortReason.Load().(string),
		PlannedDurationMs:   in.PlannedDurationMs,
		Adaptive:            in.Adaptive,
	}
}
