package loadtest

import (
	"testing"
	"time"
)

func TestAdaptiveController_BecomesStableBeforeInstability(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	now := start
	maxUsers := int64(10)

	fr := 0.0
	rps := 5.0

	// First tick after reaching max: sets stableSince.
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  5 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      maxUsers,
		WindowSent:        25,
		WindowFR:          &fr,
		WindowRPS:         &rps,
	}, s)

	// After stable duration.
	now = now.Add(2 * time.Second)
	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  5 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      maxUsers,
		WindowSent:        25,
		WindowFR:          &fr,
		WindowRPS:         &rps,
	}, s)

	if !res.Stop {
		t.Fatalf("expected stop when stable")
	}
	if s.Stabilized == nil || *s.Stabilized != true {
		t.Fatalf("expected Stabilized true")
	}
	if s.Phase != "stable" {
		t.Fatalf("expected phase stable, got %q", s.Phase)
	}
	if s.PeakUsers == nil || *s.PeakUsers != maxUsers {
		t.Fatalf("expected PeakUsers=%d", maxUsers)
	}
	if s.StableUsers == nil || *s.StableUsers != maxUsers {
		t.Fatalf("expected StableUsers=%d", maxUsers)
	}
	if s.BackoffSteps == nil || *s.BackoffSteps != 0 {
		t.Fatalf("expected BackoffSteps=0")
	}
}

func TestAdaptiveController_BecomesStableBeforeInstability_WithDurationDoesNotStop(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	now := start
	stopAt := start.Add(30 * time.Second)
	maxUsers := int64(10)

	fr := 0.0
	rps := 5.0

	// First tick after reaching max: sets stableSince.
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		HasDuration:       true,
		StopAt:            stopAt,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  5 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      maxUsers,
		WindowSent:        25,
		WindowFR:          &fr,
		WindowRPS:         &rps,
	}, s)

	// After stable duration.
	now = now.Add(2 * time.Second)
	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		HasDuration:       true,
		StopAt:            stopAt,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  5 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      maxUsers,
		WindowSent:        25,
		WindowFR:          &fr,
		WindowRPS:         &rps,
	}, s)

	if res.Stop {
		t.Fatalf("did not expect stop when stable and duration is set")
	}
	if s.Stabilized == nil || *s.Stabilized != true {
		t.Fatalf("expected Stabilized true")
	}
	if s.Phase != "stable" {
		t.Fatalf("expected phase stable, got %q", s.Phase)
	}
}

func TestAdaptiveController_FirstInstabilityDisablesRampingAndCapturesPeak(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	now := start.Add(3 * time.Second)
	maxUsers := int64(10)
	allowed := int64(7)

	fr := 0.05
	rps := 12.0

	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 20,
		AdaptiveCooldown:  5 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      allowed,
		WindowSent:        25,
		WindowFR:          &fr,
		WindowRPS:         &rps,
	}, s)

	if !res.DisableRamping {
		t.Fatalf("expected disableRamping")
	}
	if s.Phase != "backing_off" {
		t.Fatalf("expected phase backing_off, got %q", s.Phase)
	}
	if s.PeakUsers == nil || *s.PeakUsers != allowed {
		t.Fatalf("expected PeakUsers=%d", allowed)
	}
	if s.TimeToFirstFailureMs == nil || *s.TimeToFirstFailureMs <= 0 {
		t.Fatalf("expected TimeToFirstFailureMs to be set")
	}
	if s.PeakWindowFailureRate == nil || *s.PeakWindowFailureRate != fr {
		t.Fatalf("expected PeakWindowFailureRate=%v", fr)
	}
	if s.PeakWindowRps == nil || *s.PeakWindowRps != rps {
		t.Fatalf("expected PeakWindowRps=%v", rps)
	}
}

func TestAdaptiveController_BackoffHonorsCooldownAndEventuallyExhausts(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	maxUsers := int64(10)

	// Force first instability.
	frBad := 0.05
	rps := 1.0
	now := start.Add(1 * time.Second)
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 10,
		AdaptiveCooldown:  2 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      5,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)

	// Within cooldown: no adjustment.
	now = now.Add(1 * time.Second)
	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 10,
		AdaptiveCooldown:  2 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      5,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)
	if res.SetAllowedUsers != nil {
		t.Fatalf("expected no adjustment during cooldown")
	}

	// After cooldown: adjust down.
	now = now.Add(2 * time.Second)
	res = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 10,
		AdaptiveCooldown:  2 * time.Second,
		BackoffStepUsers:  2,
		AllowedUsers:      5,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)
	if res.SetAllowedUsers == nil || *res.SetAllowedUsers != 3 {
		t.Fatalf("expected allowedUsers to reduce to 3, got %v", res.SetAllowedUsers)
	}

	// Exhaust to 1 -> abort.
	now = now.Add(2 * time.Second)
	res = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 10,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      2,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)
	if !res.Abort || res.AbortReason == "" || !res.Stop {
		t.Fatalf("expected abort+stop on exhaustion")
	}
	if res.SetAllowedUsers == nil || *res.SetAllowedUsers != 1 {
		t.Fatalf("expected allowedUsers set to 1 on exhaustion")
	}
	if s.Phase != "exhausted" {
		t.Fatalf("expected phase exhausted")
	}
}

func TestAdaptiveController_StableAfterBackoff(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	maxUsers := int64(10)

	// First instability.
	frBad := 0.05
	rps := 1.0
	now := start.Add(1 * time.Second)
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      5,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)

	// Healthy starts stable timer.
	frGood := 0.0
	now = now.Add(1 * time.Second)
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      3,
		WindowSent:        25,
		WindowFR:          &frGood,
		WindowRPS:         &rps,
	}, s)

	// After stable duration -> stop.
	now = now.Add(2 * time.Second)
	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      3,
		WindowSent:        25,
		WindowFR:          &frGood,
		WindowRPS:         &rps,
	}, s)

	if !res.Stop {
		t.Fatalf("expected stop")
	}
	if s.Phase != "stable" {
		t.Fatalf("expected phase stable")
	}
	if s.StableUsers == nil || *s.StableUsers != 3 {
		t.Fatalf("expected StableUsers=3")
	}
}

func TestAdaptiveController_StableAfterBackoff_WithDurationDoesNotStop(t *testing.T) {
	c := NewAdaptiveController()
	s := &AdaptiveSummary{Enabled: true, Phase: "ramping"}

	start := time.Unix(1000, 0)
	stopAt := start.Add(30 * time.Second)
	maxUsers := int64(10)

	// First instability.
	frBad := 0.05
	rps := 1.0
	now := start.Add(1 * time.Second)
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		HasDuration:       true,
		StopAt:            stopAt,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      5,
		WindowSent:        25,
		WindowFR:          &frBad,
		WindowRPS:         &rps,
	}, s)

	// Healthy starts stable timer.
	frGood := 0.0
	now = now.Add(1 * time.Second)
	_ = c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		HasDuration:       true,
		StopAt:            stopAt,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      3,
		WindowSent:        25,
		WindowFR:          &frGood,
		WindowRPS:         &rps,
	}, s)

	// After stable duration.
	now = now.Add(2 * time.Second)
	res := c.Step(AdaptiveControllerStepInput{
		Now:               now,
		StartedAt:         start,
		HasDuration:       true,
		StopAt:            stopAt,
		MaxUsers:          maxUsers,
		AdaptiveFailure:   0.01,
		AdaptiveStableSec: 2,
		AdaptiveCooldown:  0,
		BackoffStepUsers:  2,
		AllowedUsers:      3,
		WindowSent:        25,
		WindowFR:          &frGood,
		WindowRPS:         &rps,
	}, s)

	if res.Stop {
		t.Fatalf("did not expect stop when stable and duration is set")
	}
	if s.Phase != "stable" {
		t.Fatalf("expected phase stable")
	}
}
