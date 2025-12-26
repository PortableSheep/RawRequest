package loadtestpayload

import "testing"

func TestBuildProgressPayload(t *testing.T) {
	planned := int64(123)
	p := BuildProgressPayload(ProgressInput{
		RequestID:         "r1",
		StartedAtMs:       10,
		PlannedDurationMs: &planned,
		ActiveUsers:       2,
		MaxUsers:          5,
		TotalSent:         9,
		Successful:        8,
		Failed:            1,
		Done:              true,
		Cancelled:         false,
		Aborted:           true,
		AbortReason:       "too many failures",
	})

	if p.Type != "load" {
		t.Fatalf("unexpected type: %q", p.Type)
	}
	if p.RequestID != "r1" || p.StartedAt != 10 || p.ActiveUsers != 2 || p.MaxUsers != 5 {
		t.Fatalf("unexpected payload: %#v", p)
	}
	if p.PlannedDurationMs == nil || *p.PlannedDurationMs != 123 {
		t.Fatalf("unexpected planned duration: %#v", p.PlannedDurationMs)
	}
	if !p.Done || p.Cancelled || !p.Aborted || p.AbortReason != "too many failures" {
		t.Fatalf("unexpected flags: %#v", p)
	}
}
