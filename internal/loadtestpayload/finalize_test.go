package loadtestpayload

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	lt "rawrequest/internal/loadtest"
)

func TestBuildResults_CopiesMapsAndSlices(t *testing.T) {
	var statusMu sync.Mutex
	statusCounts := map[string]int64{"500": 2}
	var rtMu sync.Mutex
	responseTimes := []int64{10, 20}

	aborted := atomic.Bool{}
	abortReason := atomic.Value{}
	abortReason.Store("")

	var total atomic.Int64
	var ok atomic.Int64
	var failed atomic.Int64
	total.Store(2)
	ok.Store(1)
	failed.Store(1)

	ctx := context.Background()
	adaptive := &lt.AdaptiveSummary{Enabled: false}

	res := BuildResults(FinalizeInput{
		Ctx:           ctx,
		StartMs:       1,
		EndMs:         2,
		Adaptive:      adaptive,
		Aborted:       &aborted,
		AbortReason:   &abortReason,
		TotalSent:     &total,
		OkSent:        &ok,
		FailedSent:    &failed,
		Cancelled:     false,
		StatusMu:      &statusMu,
		StatusCounts:  statusCounts,
		RtMu:          &rtMu,
		ResponseTimes: responseTimes,
	})

	statusCounts["500"] = 99
	responseTimes[0] = 999

	if res.FailureStatusCounts["500"] != 2 {
		t.Fatalf("expected counts copy to be independent")
	}
	if len(res.ResponseTimesMs) != 2 || res.ResponseTimesMs[0] != 10 {
		t.Fatalf("expected response times copy to be independent")
	}
}

func TestBuildResults_CancelledOnlyWhenCtxCanceled(t *testing.T) {
	var statusMu sync.Mutex
	statusCounts := map[string]int64{}
	var rtMu sync.Mutex
	responseTimes := []int64{}

	aborted := atomic.Bool{}
	abortReason := atomic.Value{}
	abortReason.Store("")

	var total atomic.Int64
	var ok atomic.Int64
	var failed atomic.Int64

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	res := BuildResults(FinalizeInput{
		Ctx:           canceledCtx,
		StartMs:       1,
		EndMs:         2,
		Adaptive:      &lt.AdaptiveSummary{Enabled: false},
		Aborted:       &aborted,
		AbortReason:   &abortReason,
		TotalSent:     &total,
		OkSent:        &ok,
		FailedSent:    &failed,
		Cancelled:     true,
		StatusMu:      &statusMu,
		StatusCounts:  statusCounts,
		RtMu:          &rtMu,
		ResponseTimes: responseTimes,
	})

	if !res.Cancelled {
		t.Fatalf("expected cancelled true")
	}

	notCanceledRes := BuildResults(FinalizeInput{
		Ctx:           context.Background(),
		StartMs:       1,
		EndMs:         2,
		Adaptive:      &lt.AdaptiveSummary{Enabled: false},
		Aborted:       &aborted,
		AbortReason:   &abortReason,
		TotalSent:     &total,
		OkSent:        &ok,
		FailedSent:    &failed,
		Cancelled:     true,
		StatusMu:      &statusMu,
		StatusCounts:  statusCounts,
		RtMu:          &rtMu,
		ResponseTimes: responseTimes,
	})

	if notCanceledRes.Cancelled {
		t.Fatalf("expected cancelled false when ctx not canceled")
	}
}
