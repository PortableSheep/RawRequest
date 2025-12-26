package loadtest

import (
	"testing"
	"time"
)

func TestAdaptiveWindowRing_DisabledIsNoop(t *testing.T) {
	ring := NewAdaptiveWindowRing(false, 15)
	ring.Record(time.Unix(1000, 0), true)
	_, _, fr, rps := ring.Stats(time.Unix(1000, 0))
	if fr != nil || rps != nil {
		t.Fatalf("expected nil stats when disabled")
	}
}

func TestAdaptiveWindowRing_StatsAcrossWindow(t *testing.T) {
	ring := NewAdaptiveWindowRing(true, 3)
	// Window = 3 seconds (sec 1000..1002)
	base := time.Unix(1000, 0)
	ring.Record(base, false)                    // 1000: 1 sent, 0 fail
	ring.Record(base.Add(1*time.Second), true)  // 1001: 1 sent, 1 fail
	ring.Record(base.Add(2*time.Second), false) // 1002: 1 sent, 0 fail

	sent, failed, fr, rps := ring.Stats(base.Add(2 * time.Second))
	if sent != 3 || failed != 1 {
		t.Fatalf("expected sent=3 failed=1, got %d/%d", sent, failed)
	}
	if fr == nil || *fr != (1.0/3.0) {
		t.Fatalf("expected failureRate=1/3, got %v", fr)
	}
	if rps == nil || *rps != 1.0 {
		t.Fatalf("expected rps=1.0 (3/3sec), got %v", rps)
	}
}

func TestAdaptiveWindowRing_DropsOldBuckets(t *testing.T) {
	ring := NewAdaptiveWindowRing(true, 3)
	base := time.Unix(1000, 0)
	ring.Record(base, true)                     // 1000
	ring.Record(base.Add(4*time.Second), false) // 1004

	sent, failed, fr, _ := ring.Stats(base.Add(4 * time.Second))
	// Only sec 1002..1004 are in window; we only recorded at 1004.
	if sent != 1 || failed != 0 || fr == nil || *fr != 0 {
		t.Fatalf("expected only latest bucket counted, got sent=%d failed=%d fr=%v", sent, failed, fr)
	}
}
