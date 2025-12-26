package loadtest

import "testing"

func TestFailureRateAbortDecision_NoThreshold(t *testing.T) {
	abort, reason := FailureRateAbortDecision(100, 50, 0.2, false)
	if abort || reason != "" {
		t.Fatalf("expected no abort")
	}
}

func TestFailureRateAbortDecision_InsufficientSamples(t *testing.T) {
	abort, reason := FailureRateAbortDecision(19, 19, 0.01, true)
	if abort || reason != "" {
		t.Fatalf("expected no abort below min samples")
	}
}

func TestFailureRateAbortDecision_TriggersOnEqualThreshold(t *testing.T) {
	abort, reason := FailureRateAbortDecision(20, 1, 0.05, true) // 1/20 = 5%
	if !abort {
		t.Fatalf("expected abort")
	}
	expected := "Failure rate 5.0% exceeded threshold 5.0%"
	if reason != expected {
		t.Fatalf("expected %q, got %q", expected, reason)
	}
}

func TestFailureRateAbortDecision_DoesNotTriggerBelowThreshold(t *testing.T) {
	abort, _ := FailureRateAbortDecision(20, 1, 0.06, true) // 5% < 6%
	if abort {
		t.Fatalf("expected no abort")
	}
}
