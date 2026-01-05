package loadtest

import "time"

type AdaptiveController struct {
	minSamples int64

	sawInstability bool
	stableSinceSet bool
	stableSince    time.Time
	lastAdjust     time.Time
	backoffSteps   int64
	allowRamping   bool
}

type AdaptiveControllerStepInput struct {
	Now       time.Time
	StartedAt time.Time

	HasDuration bool
	StopAt      time.Time

	MaxUsers          int64
	AdaptiveFailure   float64
	AdaptiveStableSec int64
	AdaptiveCooldown  time.Duration
	BackoffStepUsers  int64

	AllowedUsers int64

	WindowSent int64
	WindowFR   *float64
	WindowRPS  *float64
}

type AdaptiveControllerStepResult struct {
	DisableRamping  bool
	SetAllowedUsers *int64

	Stop bool

	Abort       bool
	AbortReason string
}

func NewAdaptiveController() *AdaptiveController {
	return &AdaptiveController{
		minSamples:   20,
		allowRamping: true,
	}
}

func (c *AdaptiveController) Step(in AdaptiveControllerStepInput, adaptive *AdaptiveSummary) AdaptiveControllerStepResult {
	// Mirror the controller goroutine exit conditions.
	if c == nil {
		return AdaptiveControllerStepResult{}
	}
	if in.HasDuration && !in.StopAt.IsZero() && in.Now.After(in.StopAt) {
		return AdaptiveControllerStepResult{}
	}
	if in.WindowFR == nil || in.WindowSent < c.minSamples {
		return AdaptiveControllerStepResult{}
	}

	fr := *in.WindowFR
	var rps float64
	if in.WindowRPS != nil {
		rps = *in.WindowRPS
	}

	// Pre-instability phase.
	if !c.sawInstability {
		if fr > in.AdaptiveFailure {
			c.sawInstability = true
			if c.allowRamping {
				c.allowRamping = false
			}

			now := in.Now
			ttff := now.Sub(in.StartedAt).Milliseconds()
			peakUsers := in.AllowedUsers
			frCopy := fr
			rpsCopy := rps

			if adaptive != nil {
				adaptive.Phase = "backing_off"
				adaptive.PeakUsers = &peakUsers
				adaptive.TimeToFirstFailureMs = &ttff
				adaptive.PeakWindowFailureRate = &frCopy
				adaptive.PeakWindowRps = &rpsCopy
			}

			c.stableSinceSet = false
			c.lastAdjust = now
			return AdaptiveControllerStepResult{DisableRamping: true, Stop: false}
		}

		// Healthy: only consider stable after reaching max.
		if in.AllowedUsers >= in.MaxUsers {
			if !c.stableSinceSet {
				c.stableSinceSet = true
				c.stableSince = in.Now
			}
			if in.Now.Sub(c.stableSince) >= time.Duration(in.AdaptiveStableSec)*time.Second {
				st := true
				maxU := in.MaxUsers
				frCopy := fr
				rpsCopy := rps
				if adaptive != nil {
					adaptive.Stabilized = &st
					adaptive.Phase = "stable"
					adaptive.PeakUsers = &maxU
					adaptive.StableUsers = &maxU
					adaptive.BackoffSteps = ptrInt64(0)
					adaptive.PeakWindowFailureRate = &frCopy
					adaptive.StableWindowFailureRate = &frCopy
					adaptive.PeakWindowRps = &rpsCopy
					adaptive.StableWindowRps = &rpsCopy
				}
				// If a duration is configured, hold the stable user count until stopAt.
				return AdaptiveControllerStepResult{DisableRamping: true, Stop: !in.HasDuration}
			}
		} else {
			c.stableSinceSet = false
		}

		return AdaptiveControllerStepResult{}
	}

	// Post-instability (backoff) phase.
	if fr > in.AdaptiveFailure {
		c.stableSinceSet = false
		if !c.lastAdjust.IsZero() && in.Now.Sub(c.lastAdjust) < in.AdaptiveCooldown {
			return AdaptiveControllerStepResult{}
		}
		prev := in.AllowedUsers
		next := prev - in.BackoffStepUsers
		if next < 1 {
			next = 1
		}
		if next < prev {
			c.backoffSteps++
		}

		backoffCopy := c.backoffSteps
		if adaptive != nil {
			adaptive.Phase = "backing_off"
			adaptive.BackoffSteps = &backoffCopy
		}
		c.lastAdjust = in.Now

		if next <= 1 {
			if adaptive != nil {
				adaptive.Phase = "exhausted"
			}
			return AdaptiveControllerStepResult{SetAllowedUsers: &next, Abort: true, AbortReason: "Adaptive backoff exhausted", Stop: true}
		}
		return AdaptiveControllerStepResult{SetAllowedUsers: &next}
	}

	// Healthy in backoff.
	if !c.stableSinceSet {
		c.stableSinceSet = true
		c.stableSince = in.Now
	}
	if in.Now.Sub(c.stableSince) >= time.Duration(in.AdaptiveStableSec)*time.Second {
		st := true
		stableUsers := in.AllowedUsers
		frCopy := fr
		rpsCopy := rps
		if adaptive != nil {
			adaptive.Stabilized = &st
			adaptive.Phase = "stable"
			adaptive.StableUsers = &stableUsers
			adaptive.StableWindowFailureRate = &frCopy
			adaptive.StableWindowRps = &rpsCopy
		}
		// If a duration is configured, hold the stable user count until stopAt.
		return AdaptiveControllerStepResult{DisableRamping: true, Stop: !in.HasDuration}
	}

	return AdaptiveControllerStepResult{}
}
