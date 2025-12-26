package loadtest

type AdaptiveSummary struct {
	Enabled                 bool     `json:"enabled"`
	Stabilized              *bool    `json:"stabilized,omitempty"`
	Phase                   string   `json:"phase,omitempty"`
	PeakUsers               *int64   `json:"peakUsers,omitempty"`
	StableUsers             *int64   `json:"stableUsers,omitempty"`
	TimeToFirstFailureMs    *int64   `json:"timeToFirstFailureMs,omitempty"`
	BackoffSteps            *int64   `json:"backoffSteps,omitempty"`
	PeakWindowFailureRate   *float64 `json:"peakWindowFailureRate,omitempty"`
	StableWindowFailureRate *float64 `json:"stableWindowFailureRate,omitempty"`
	PeakWindowRps           *float64 `json:"peakWindowRps,omitempty"`
	StableWindowRps         *float64 `json:"stableWindowRps,omitempty"`
}
