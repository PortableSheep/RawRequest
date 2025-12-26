package loadtestpayload

import lt "rawrequest/internal/loadtest"

type Results struct {
	TotalRequests       int64               `json:"totalRequests"`
	SuccessfulRequests  int64               `json:"successfulRequests"`
	FailedRequests      int64               `json:"failedRequests"`
	FailureStatusCounts map[string]int64    `json:"failureStatusCounts"`
	ResponseTimesMs     []int64             `json:"responseTimes"`
	StartTimeMs         int64               `json:"startTime"`
	EndTimeMs           int64               `json:"endTime"`
	Cancelled           bool                `json:"cancelled,omitempty"`
	Aborted             bool                `json:"aborted,omitempty"`
	AbortReason         string              `json:"abortReason,omitempty"`
	PlannedDurationMs   *int64              `json:"plannedDurationMs,omitempty"`
	Adaptive            *lt.AdaptiveSummary `json:"adaptive,omitempty"`
}

type ActiveRunProgressPayload struct {
	RequestID         string `json:"requestId"`
	Type              string `json:"type"`
	StartedAt         int64  `json:"startedAt"`
	PlannedDurationMs *int64 `json:"plannedDurationMs,omitempty"`
	ActiveUsers       int64  `json:"activeUsers,omitempty"`
	MaxUsers          int64  `json:"maxUsers,omitempty"`
	TotalSent         int64  `json:"totalSent,omitempty"`
	Successful        int64  `json:"successful,omitempty"`
	Failed            int64  `json:"failed,omitempty"`
	Done              bool   `json:"done,omitempty"`
	Cancelled         bool   `json:"cancelled,omitempty"`
	Aborted           bool   `json:"aborted,omitempty"`
	AbortReason       string `json:"abortReason,omitempty"`
}

type DonePayload struct {
	RequestID string  `json:"requestId"`
	Results   Results `json:"results"`
}
