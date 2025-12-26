package loadtest

import (
	"math"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Iterations           *int   `json:"iterations"`
	Duration             string `json:"duration"`
	Concurrent           *int   `json:"concurrent"`
	Users                *int   `json:"users"`
	Concurrency          *int   `json:"concurrency"`
	Start                *int   `json:"start"`
	StartUsers           *int   `json:"startUsers"`
	Max                  *int   `json:"max"`
	MaxUsers             *int   `json:"maxUsers"`
	SpawnRate            *int   `json:"spawnRate"`
	RampUp               string `json:"rampUp"`
	Delay                string `json:"delay"`
	WaitMin              string `json:"waitMin"`
	WaitMax              string `json:"waitMax"`
	RequestsPerSecond    *int   `json:"requestsPerSecond"`
	FailureRateThreshold any    `json:"failureRateThreshold"`

	Adaptive            any `json:"adaptive"`
	AdaptiveFailureRate any `json:"adaptiveFailureRate"`
	AdaptiveWindow      any `json:"adaptiveWindow"`
	AdaptiveStable      any `json:"adaptiveStable"`
	AdaptiveCooldown    any `json:"adaptiveCooldown"`
	AdaptiveBackoffStep any `json:"adaptiveBackoffStep"`
}

type NormalizedConfig struct {
	Iterations        int64
	HasIterations     bool
	DurationMs        int64
	HasDuration       bool
	StartUsers        int64
	MaxUsers          int64
	SpawnRate         int64
	HasSpawnRate      bool
	RampUpMs          int64
	HasRampUp         bool
	DelayMs           int64
	WaitMinMs         int64
	WaitMaxMs         int64
	HasWaitRange      bool
	RequestsPerSecond int64
	HasRps            bool
	FailureThreshold  float64
	HasFailureThresh  bool

	AdaptiveEnabled          bool
	AdaptiveFailureRate      float64
	AdaptiveWindowSec        int64
	AdaptiveStableSec        int64
	AdaptiveCooldownMs       int64
	AdaptiveBackoffStepUsers int64
}

func NormalizeConfig(cfg Config) (NormalizedConfig, error) {
	toInt := func(p *int) *int64 {
		if p == nil {
			return nil
		}
		v := int64(*p)
		return &v
	}
	iterationsPtr := toInt(cfg.Iterations)
	concurrent := firstInt64(toInt(cfg.Concurrent), toInt(cfg.Users), toInt(cfg.Concurrency), toInt(cfg.StartUsers), toInt(cfg.Start))
	maxUsers := firstInt64(toInt(cfg.MaxUsers), toInt(cfg.Max), toInt(cfg.Concurrent), toInt(cfg.Users), toInt(cfg.Concurrency))
	startUsers := firstInt64(toInt(cfg.StartUsers), toInt(cfg.Start), toInt(cfg.Concurrent), toInt(cfg.Users), toInt(cfg.Concurrency))
	if startUsers <= 0 {
		startUsers = 1
	}
	if maxUsers <= 0 {
		maxUsers = 1
	}
	if startUsers > maxUsers {
		startUsers = maxUsers
	}
	_ = concurrent

	durationMs := parseDurationMsGo(strings.TrimSpace(cfg.Duration))
	hasDuration := durationMs > 0
	hasIterations := iterationsPtr != nil && *iterationsPtr > 0
	iterations := int64(10)
	if hasIterations {
		iterations = *iterationsPtr
	}
	if !hasDuration && !hasIterations {
		hasIterations = true
		iterations = 10
	}

	spawnRatePtr := toInt(cfg.SpawnRate)
	spawnRate := int64(0)
	hasSpawn := false
	if spawnRatePtr != nil && *spawnRatePtr > 0 {
		spawnRate = *spawnRatePtr
		hasSpawn = true
	}
	rampUpMs := parseDurationMsGo(strings.TrimSpace(cfg.RampUp))
	hasRamp := rampUpMs > 0

	delayMs := parseDurationMsGo(strings.TrimSpace(cfg.Delay))
	if delayMs < 0 {
		delayMs = 0
	}
	waitMin := parseDurationMsGo(strings.TrimSpace(cfg.WaitMin))
	waitMax := parseDurationMsGo(strings.TrimSpace(cfg.WaitMax))
	hasWait := waitMin > 0 || waitMax > 0
	if !hasWait {
		waitMin = 0
		waitMax = 0
	}

	rps := int64(0)
	hasRps := false
	if cfg.RequestsPerSecond != nil && *cfg.RequestsPerSecond > 0 {
		rps = int64(*cfg.RequestsPerSecond)
		hasRps = true
	}

	thresh, hasThresh := parseFailureRateThresholdGo(cfg.FailureRateThreshold)

	adaptiveEnabled := parseBoolGo(cfg.Adaptive)
	adaptiveFr, _ := parseFailureRateThresholdGo(cfg.AdaptiveFailureRate)
	if adaptiveEnabled && adaptiveFr <= 0 {
		adaptiveFr = 0.01
	}
	adaptiveWindowSec := parseSecondsGo(cfg.AdaptiveWindow, 15)
	adaptiveStableSec := parseSecondsGo(cfg.AdaptiveStable, 20)
	adaptiveCooldownMs := parseSecondsGo(cfg.AdaptiveCooldown, 5) * 1000
	backoffStep := parseIntAnyGo(cfg.AdaptiveBackoffStep, 2)
	if backoffStep < 1 {
		backoffStep = 1
	}

	return NormalizedConfig{
		Iterations:        iterations,
		HasIterations:     hasIterations,
		DurationMs:        durationMs,
		HasDuration:       hasDuration,
		StartUsers:        startUsers,
		MaxUsers:          maxUsers,
		SpawnRate:         spawnRate,
		HasSpawnRate:      hasSpawn,
		RampUpMs:          rampUpMs,
		HasRampUp:         hasRamp,
		DelayMs:           maxInt64(0, delayMs),
		WaitMinMs:         maxInt64(0, waitMin),
		WaitMaxMs:         maxInt64(0, waitMax),
		HasWaitRange:      hasWait,
		RequestsPerSecond: rps,
		HasRps:            hasRps,
		FailureThreshold:  thresh,
		HasFailureThresh:  hasThresh,

		AdaptiveEnabled:          adaptiveEnabled,
		AdaptiveFailureRate:      adaptiveFr,
		AdaptiveWindowSec:        adaptiveWindowSec,
		AdaptiveStableSec:        adaptiveStableSec,
		AdaptiveCooldownMs:       adaptiveCooldownMs,
		AdaptiveBackoffStepUsers: int64(backoffStep),
	}, nil
}

func parseDurationMsGo(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if isAllNumber(raw) {
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(f) || f < 0 {
			return 0
		}
		return int64(math.Round(f))
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0
	}
	if d < 0 {
		return 0
	}
	return d.Milliseconds()
}

func parseFailureRateThresholdGo(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		frac := t
		if frac > 1 {
			frac = frac / 100
		}
		return clamp01(frac), true
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return 0, false
		}
		if strings.HasSuffix(s, "%") {
			n, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(s, "%")), 64)
			if err != nil || n < 0 {
				return 0, false
			}
			return clamp01(n / 100), true
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil || n < 0 {
			return 0, false
		}
		if n > 1 {
			n = n / 100
		}
		return clamp01(n), true
	default:
		return 0, false
	}
}

func parseSecondsGo(v any, fallback int64) int64 {
	if v == nil {
		return fallback
	}
	switch t := v.(type) {
	case float64:
		if t <= 0 {
			return fallback
		}
		return int64(t)
	case int:
		if t <= 0 {
			return fallback
		}
		return int64(t)
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return fallback
		}
		ms := parseDurationMsGo(s)
		if ms <= 0 {
			return fallback
		}
		return int64(math.Round(float64(ms) / 1000))
	default:
		return fallback
	}
}

func parseIntAnyGo(v any, fallback int) int {
	if v == nil {
		return fallback
	}
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return fallback
		}
		n, err := strconv.Atoi(s)
		if err != nil {
			return fallback
		}
		return n
	default:
		return fallback
	}
}

func parseBoolGo(v any) bool {
	if v == nil {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case int:
		return t != 0
	case string:
		s := strings.TrimSpace(strings.ToLower(t))
		return s == "true" || s == "1" || s == "yes" || s == "y" || s == "on"
	default:
		return false
	}
}

func firstInt64(vals ...*int64) int64 {
	for _, p := range vals {
		if p != nil && *p > 0 {
			return *p
		}
	}
	return 0
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func isAllNumber(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, ch := range s {
		if (ch < '0' || ch > '9') && ch != '.' {
			return false
		}
	}
	return true
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func ptrInt64(v int64) *int64 { return &v }
