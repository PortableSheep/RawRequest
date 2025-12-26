package loadtestpayload

type ProgressInput struct {
	RequestID         string
	StartedAtMs       int64
	PlannedDurationMs *int64
	ActiveUsers       int64
	MaxUsers          int64
	TotalSent         int64
	Successful        int64
	Failed            int64
	Done              bool
	Cancelled         bool
	Aborted           bool
	AbortReason       string
}

func BuildProgressPayload(in ProgressInput) ActiveRunProgressPayload {
	return ActiveRunProgressPayload{
		RequestID:         in.RequestID,
		Type:              "load",
		StartedAt:         in.StartedAtMs,
		PlannedDurationMs: in.PlannedDurationMs,
		ActiveUsers:       in.ActiveUsers,
		MaxUsers:          in.MaxUsers,
		TotalSent:         in.TotalSent,
		Successful:        in.Successful,
		Failed:            in.Failed,
		Done:              in.Done,
		Cancelled:         in.Cancelled,
		Aborted:           in.Aborted,
		AbortReason:       in.AbortReason,
	}
}
