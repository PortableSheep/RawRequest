//go:build rawrequest_internal_ignore
// +build rawrequest_internal_ignore

package main

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	loadTestProgressEventName = "loadtest:progress"
	loadTestDoneEventName     = "loadtest:done"
	loadTestErrorEventName    = "loadtest:error"
)

type loadTestConfig struct {
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

type normalizedLoadTestConfig struct {
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

type adaptiveSummary struct {
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

type loadTestResults struct {
	TotalRequests       int64            `json:"totalRequests"`
	SuccessfulRequests  int64            `json:"successfulRequests"`
	FailedRequests      int64            `json:"failedRequests"`
	FailureStatusCounts map[string]int64 `json:"failureStatusCounts"`
	ResponseTimesMs     []int64          `json:"responseTimes"`
	StartTimeMs         int64            `json:"startTime"`
	EndTimeMs           int64            `json:"endTime"`
	Cancelled           bool             `json:"cancelled,omitempty"`
	Aborted             bool             `json:"aborted,omitempty"`
	AbortReason         string           `json:"abortReason,omitempty"`
	PlannedDurationMs   *int64           `json:"plannedDurationMs,omitempty"`
	Adaptive            *adaptiveSummary `json:"adaptive,omitempty"`
}

type activeRunProgressPayload struct {
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

type loadTestDonePayload struct {
	RequestID string          `json:"requestId"`
	Results   loadTestResults `json:"results"`
}

func (a *App) StartLoadTest(requestID, method, url, headersJSON, body, loadConfigJSON string) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return errors.New("missing requestId")
	}
	method = strings.TrimSpace(method)
	url = strings.TrimSpace(url)
	if method == "" || url == "" {
		return errors.New("missing method or url")
	}

	var cfg loadTestConfig
	if err := json.Unmarshal([]byte(loadConfigJSON), &cfg); err != nil {
		return err
	}
	norm, err := normalizeLoadTestConfigGo(cfg)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	a.registerCancel(requestID, cancel)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				if a.ctx != nil {
					wailsruntime.EventsEmit(a.ctx, loadTestErrorEventName, map[string]any{
						"requestId": requestID,
						"message":   "Load test panicked",
					})
				}
			}
			cancel()
			a.clearCancel(requestID)
		}()
		a.runLoadTest(ctx, cancel, requestID, method, url, headersJSON, body, norm)
	}()

	return nil
}

func (a *App) runLoadTest(ctx context.Context, cancel context.CancelFunc, requestID, method, url, headersJSON, body string, cfg normalizedLoadTestConfig) {
	start := time.Now()
	startMs := start.UnixMilli()
	var plannedDurationMs *int64
	if cfg.HasDuration {
		v := cfg.DurationMs
		plannedDurationMs = &v
	}

	stopAt := time.Time{}
	if cfg.HasDuration {
		stopAt = start.Add(time.Duration(cfg.DurationMs) * time.Millisecond)
	}

	// Internal stop signal for normal completion (e.g., adaptive stable) or abort conditions.
	stopCh := make(chan struct{})
	var stopOnce sync.Once
	stop := func() { stopOnce.Do(func() { close(stopCh) }) }
	isStopped := func() bool {
		select {
		case <-stopCh:
			return true
		default:
			return false
		}
	}

	var issued int64
	reserveSlot := func() bool {
		if !cfg.HasIterations {
			return true
		}
		n := atomic.AddInt64(&issued, 1)
		return n <= cfg.Iterations
	}

	var aborted atomic.Bool
	abortReason := atomic.Value{}
	abortReason.Store("")

	var activeUsers atomic.Int64

	// Results aggregation
	var totalSent atomic.Int64
	var okSent atomic.Int64
	var failedSent atomic.Int64
	statusCounts := map[string]int64{}
	var statusMu sync.Mutex
	responseTimes := make([]int64, 0, 1024)
	var rtMu sync.Mutex

	// Adaptive window ring
	windowLen := int64(maxInt64(3, cfg.AdaptiveWindowSec))
	type bucket struct {
		sec    int64
		sent   int64
		failed int64
	}
	ring := make([]bucket, windowLen+2)
	var ringMu sync.Mutex
	recordWindow := func(now time.Time, isFailure bool) {
		if !cfg.AdaptiveEnabled {
			return
		}
		sec := now.Unix()
		idx := sec % int64(len(ring))
		ringMu.Lock()
		b := &ring[idx]
		if b.sec != sec {
			b.sec = sec
			b.sent = 0
			b.failed = 0
		}
		b.sent++
		if isFailure {
			b.failed++
		}
		ringMu.Unlock()
	}
	getWindowStats := func(now time.Time) (sent, failed int64, failureRate *float64, rps *float64) {
		if !cfg.AdaptiveEnabled {
			return 0, 0, nil, nil
		}
		nowSec := now.Unix()
		minSec := nowSec - cfg.AdaptiveWindowSec + 1
		var s int64
		var f int64
		ringMu.Lock()
		for i := range ring {
			b := ring[i]
			if b.sec >= minSec && b.sec <= nowSec {
				s += b.sent
				f += b.failed
			}
		}
		ringMu.Unlock()
		if s <= 0 {
			return 0, 0, nil, nil
		}
		fr := float64(f) / float64(s)
		r := float64(s) / float64(cfg.AdaptiveWindowSec)
		return s, f, &fr, &r
	}

	// Adaptive state
	adaptive := &adaptiveSummary{Enabled: cfg.AdaptiveEnabled}
	if cfg.AdaptiveEnabled {
		adaptive.Phase = "ramping"
	} else {
		adaptive.Phase = "disabled"
	}

	var targetUsers atomic.Int64
	if cfg.AdaptiveEnabled {
		targetUsers.Store(cfg.StartUsers)
	} else {
		targetUsers.Store(cfg.MaxUsers)
	}

	// Provide a short, visible ramp-down after duration ends (matches the previous
	// frontend feel) by gradually reducing target users to 0. This keeps load-test
	// semantics simple while making ActiveUsers decrease over a short tail.
	if cfg.HasDuration {
		const rampDownMs int64 = 1200
		go func() {
			// Wait for the duration to elapse.
			t := time.Until(stopAt)
			if t > 0 {
				select {
				case <-ctx.Done():
					return
				case <-stopCh:
					return
				case <-time.After(t):
				}
			}
			startTarget := targetUsers.Load()
			if startTarget <= 0 {
				targetUsers.Store(0)
				return
			}
			steps := int64(24)
			interval := time.Duration(rampDownMs/steps) * time.Millisecond
			if interval < 25*time.Millisecond {
				interval = 25 * time.Millisecond
			}
			for i := int64(0); i <= steps; i++ {
				select {
				case <-ctx.Done():
					return
				case <-stopCh:
					return
				default:
				}
				// Linear ramp to zero.
				next := startTarget - (startTarget*i)/steps
				if next < 0 {
					next = 0
				}
				targetUsers.Store(next)
				if i < steps {
					time.Sleep(interval)
				}
			}
			targetUsers.Store(0)
		}()
	}

	// Global RPS spacing limiter
	var rpsMu sync.Mutex
	nextAllowed := start
	throttle := func() {
		if !cfg.HasRps {
			return
		}
		interval := time.Duration(float64(time.Second) / float64(cfg.RequestsPerSecond))
		rpsMu.Lock()
		now := time.Now()
		wait := nextAllowed.Sub(now)
		if wait < 0 {
			wait = 0
		}
		if now.After(nextAllowed) {
			nextAllowed = now
		}
		nextAllowed = nextAllowed.Add(interval)
		rpsMu.Unlock()
		if wait > 0 {
			select {
			case <-ctx.Done():
				return
			case <-stopCh:
				return
			case <-time.After(wait):
			}
		}
	}

	getUserWait := func(r *rand.Rand) time.Duration {
		if cfg.HasWaitRange {
			min := cfg.WaitMinMs
			max := cfg.WaitMaxMs
			if max < min {
				min, max = max, min
			}
			if max <= min {
				return time.Duration(min) * time.Millisecond
			}
			v := min + r.Int63n((max-min)+1)
			return time.Duration(v) * time.Millisecond
		}
		return time.Duration(cfg.DelayMs) * time.Millisecond
	}

	maybeAbortForFailureRate := func() {
		if aborted.Load() {
			return
		}
		if !cfg.HasFailureThresh {
			return
		}
		minSamples := int64(20)
		total := totalSent.Load()
		if total < minSamples || total <= 0 {
			return
		}
		rate := float64(failedSent.Load()) / float64(total)
		if rate >= cfg.FailureThreshold {
			aborted.Store(true)
			abortReason.Store(
				"Failure rate " + strconv.FormatFloat(rate*100, 'f', 1, 64) + "% exceeded threshold " + strconv.FormatFloat(cfg.FailureThreshold*100, 'f', 1, 64) + "%",
			)
		}
	}

	parseStatusAndTiming := func(result string) (status int, timingMs int64) {
		status = 0
		timingMs = 0
		// Fast parse "Status: 200 OK"
		if strings.HasPrefix(result, "Status: ") {
			lineEnd := strings.IndexByte(result, '\n')
			statusLine := result
			if lineEnd > 0 {
				statusLine = result[:lineEnd]
			}
			parts := strings.Fields(strings.TrimPrefix(statusLine, "Status: "))
			if len(parts) > 0 {
				if n, err := strconv.Atoi(parts[0]); err == nil {
					status = n
				}
			}
		}
		// Parse timing.total from metadata JSON: "Headers: {..}\nBody:"
		hIdx := strings.Index(result, "\nHeaders: ")
		bIdx := strings.Index(result, "\nBody: ")
		if hIdx >= 0 && bIdx > hIdx {
			headersStr := strings.TrimSpace(result[hIdx+len("\nHeaders: ") : bIdx])
			if headersStr != "" {
				var meta ResponseMetadata
				if json.Unmarshal([]byte(headersStr), &meta) == nil {
					timingMs = meta.Timing.Total
				}
			}
		}
		return status, timingMs
	}

	// Progress emitter
	progressTicker := time.NewTicker(200 * time.Millisecond)
	defer progressTicker.Stop()
	emitProgress := func(force bool, done bool) {
		if a.ctx == nil {
			return
		}
		payload := activeRunProgressPayload{
			RequestID:         requestID,
			Type:              "load",
			StartedAt:         startMs,
			PlannedDurationMs: plannedDurationMs,
			ActiveUsers:       activeUsers.Load(),
			MaxUsers:          cfg.MaxUsers,
			TotalSent:         totalSent.Load(),
			Successful:        okSent.Load(),
			Failed:            failedSent.Load(),
			Done:              done,
			Cancelled:         ctx.Err() == context.Canceled,
			Aborted:           aborted.Load(),
			AbortReason:       abortReason.Load().(string),
		}
		wailsruntime.EventsEmit(a.ctx, loadTestProgressEventName, payload)
		_ = force
	}

	// Worker
	worker := func(userNumber int64) {
		r := rand.New(rand.NewSource(time.Now().UnixNano() + userNumber*31))
		activeUsers.Add(1)
		defer activeUsers.Add(-1)

		for {
			if ctx.Err() != nil || isStopped() {
				return
			}
			if aborted.Load() {
				return
			}
			if userNumber > targetUsers.Load() {
				return
			}
			if !reserveSlot() {
				return
			}

			throttle()
			if ctx.Err() != nil || isStopped() || aborted.Load() {
				return
			}

			res := a.performRequest(ctx, method, url, headersJSON, body, 0)
			if res == requestCancelledResponse {
				return
			}
			status, timingMs := parseStatusAndTiming(res)
			if timingMs <= 0 {
				timingMs = time.Since(start).Milliseconds()
			}

			totalSent.Add(1)
			rtMu.Lock()
			responseTimes = append(responseTimes, timingMs)
			rtMu.Unlock()

			isFailure := status == 0 || status >= 400
			recordWindow(time.Now(), isFailure)
			if isFailure {
				failedSent.Add(1)
				statusMu.Lock()
				statusCounts[strconv.Itoa(status)]++
				statusMu.Unlock()
			} else {
				okSent.Add(1)
			}

			maybeAbortForFailureRate()
			if aborted.Load() {
				return
			}

			wait := getUserWait(r)
			if wait > 0 {
				select {
				case <-ctx.Done():
					return
				case <-stopCh:
					return
				case <-time.After(wait):
				}
			}
		}
	}

	// Spawner / ramp
	spawned := int64(0)
	var usersWG sync.WaitGroup
	spawnOne := func() {
		spawned++
		userNumber := spawned
		usersWG.Add(1)
		go func() {
			defer usersWG.Done()
			worker(userNumber)
		}()
	}

	usersDone := make(chan struct{})
	go func() {
		usersWG.Wait()
		close(usersDone)
	}()

	for i := int64(0); i < cfg.StartUsers; i++ {
		spawnOne()
	}

	remaining := cfg.MaxUsers - cfg.StartUsers
	allowRamping := atomic.Bool{}
	allowRamping.Store(true)
	// derive spawn rate
	spawnRate := cfg.SpawnRate
	if !cfg.HasSpawnRate && cfg.HasRampUp && remaining > 0 {
		seconds := float64(cfg.RampUpMs) / 1000
		if seconds > 0 {
			spawnRate = int64(math.Ceil(float64(remaining) / seconds))
			if spawnRate < 1 {
				spawnRate = 1
			}
			cfg.HasSpawnRate = true
		}
	}

	// Adaptive controller
	controllerDone := make(chan struct{})
	go func() {
		defer close(controllerDone)
		if !cfg.AdaptiveEnabled {
			return
		}
		minSamples := int64(20)
		var stableSince *time.Time
		sawInstability := false
		lastAdjust := time.Time{}
		backoffSteps := int64(0)

		tick := time.NewTicker(500 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stopCh:
				return
			case <-tick.C:
			}
			if aborted.Load() {
				return
			}
			if cfg.HasDuration && time.Now().After(stopAt) {
				return
			}
			sent, _, frPtr, rpsPtr := getWindowStats(time.Now())
			if frPtr == nil || sent < minSamples {
				continue
			}
			fr := *frPtr
			var rps float64
			if rpsPtr != nil {
				rps = *rpsPtr
			}

			if !sawInstability {
				if fr > cfg.AdaptiveFailureRate {
					sawInstability = true
					allowRamping.Store(false)
					now := time.Now()
					ttff := now.Sub(start).Milliseconds()
					peakUsers := targetUsers.Load()
					adaptive.Phase = "backing_off"
					adaptive.PeakUsers = &peakUsers
					adaptive.TimeToFirstFailureMs = &ttff
					adaptive.PeakWindowFailureRate = &fr
					adaptive.PeakWindowRps = &rps
					stableSince = nil
					lastAdjust = now
					continue
				}
				// healthy: only consider stable after reaching max
				if targetUsers.Load() >= cfg.MaxUsers {
					now := time.Now()
					if stableSince == nil {
						stableSince = &now
					}
					if now.Sub(*stableSince) >= time.Duration(cfg.AdaptiveStableSec)*time.Second {
						st := true
						maxU := cfg.MaxUsers
						adaptive.Stabilized = &st
						adaptive.Phase = "stable"
						adaptive.PeakUsers = &maxU
						adaptive.StableUsers = &maxU
						adaptive.BackoffSteps = ptrInt64(0)
						adaptive.PeakWindowFailureRate = &fr
						adaptive.StableWindowFailureRate = &fr
						adaptive.PeakWindowRps = &rps
						adaptive.StableWindowRps = &rps
						// stop once stable
						stop()
						return
					}
				} else {
					stableSince = nil
				}
				continue
			}

			// backing off phase
			if fr > cfg.AdaptiveFailureRate {
				stableSince = nil
				now := time.Now()
				if !lastAdjust.IsZero() && now.Sub(lastAdjust) < time.Duration(cfg.AdaptiveCooldownMs)*time.Millisecond {
					continue
				}
				prev := targetUsers.Load()
				next := prev - cfg.AdaptiveBackoffStepUsers
				if next < 1 {
					next = 1
				}
				if next < prev {
					backoffSteps++
				}
				targetUsers.Store(next)
				adaptive.Phase = "backing_off"
				adaptive.BackoffSteps = &backoffSteps
				lastAdjust = now
				if next <= 1 {
					adaptive.Phase = "exhausted"
					aborted.Store(true)
					abortReason.Store("Adaptive backoff exhausted")
					stop()
					return
				}
				continue
			}

			// healthy in backoff
			now := time.Now()
			if stableSince == nil {
				stableSince = &now
			}
			if now.Sub(*stableSince) >= time.Duration(cfg.AdaptiveStableSec)*time.Second {
				st := true
				stableUsers := targetUsers.Load()
				adaptive.Stabilized = &st
				adaptive.Phase = "stable"
				adaptive.StableUsers = &stableUsers
				adaptive.StableWindowFailureRate = &fr
				adaptive.StableWindowRps = &rps
				stop()
				return
			}
		}
	}()

	// Ramp spawner
	go func() {
		if remaining <= 0 {
			return
		}
		if cfg.AdaptiveEnabled {
			// In adaptive mode we still ramp, but controller may stop ramping.
		}
		if !cfg.HasSpawnRate || spawnRate <= 0 {
			for i := int64(0); i < remaining; i++ {
				if ctx.Err() != nil || isStopped() || aborted.Load() {
					return
				}
				if !allowRamping.Load() {
					return
				}
				if cfg.HasDuration && time.Now().After(stopAt) {
					return
				}
				if cfg.AdaptiveEnabled {
					v := targetUsers.Add(1)
					if v > cfg.MaxUsers {
						targetUsers.Store(cfg.MaxUsers)
					}
				}
				spawnOne()
			}
			return
		}
		interval := time.Duration(float64(time.Second) / float64(spawnRate))
		if interval < time.Millisecond {
			interval = time.Millisecond
		}
		for i := int64(0); i < remaining; i++ {
			if ctx.Err() != nil || isStopped() || aborted.Load() {
				return
			}
			if !allowRamping.Load() {
				return
			}
			if cfg.HasDuration && time.Now().After(stopAt) {
				return
			}
			if cfg.AdaptiveEnabled {
				v := targetUsers.Add(1)
				if v > cfg.MaxUsers {
					targetUsers.Store(cfg.MaxUsers)
				}
			}
			spawnOne()
			select {
			case <-ctx.Done():
				return
			case <-stopCh:
				return
			case <-time.After(interval):
			}
		}
	}()

	// main loop: progress ticks + wait for completion
	for {
		select {
		case <-ctx.Done():
			emitProgress(true, true)
			<-controllerDone
			// Let workers drain.
			<-usersDone
			endMs := time.Now().UnixMilli()
			statusMu.Lock()
			countsCopy := make(map[string]int64, len(statusCounts))
			for k, v := range statusCounts {
				countsCopy[k] = v
			}
			statusMu.Unlock()
			rtMu.Lock()
			respTimesCopy := append([]int64(nil), responseTimes...)
			rtMu.Unlock()

			res := loadTestResults{
				TotalRequests:       totalSent.Load(),
				SuccessfulRequests:  okSent.Load(),
				FailedRequests:      failedSent.Load(),
				FailureStatusCounts: countsCopy,
				ResponseTimesMs:     respTimesCopy,
				StartTimeMs:         startMs,
				EndTimeMs:           endMs,
				Cancelled:           ctx.Err() == context.Canceled && !aborted.Load(),
				Aborted:             aborted.Load(),
				AbortReason:         abortReason.Load().(string),
				PlannedDurationMs:   plannedDurationMs,
				Adaptive:            adaptive,
			}
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, loadTestDoneEventName, loadTestDonePayload{RequestID: requestID, Results: res})
			}
			return
		case <-usersDone:
			emitProgress(true, true)
			<-controllerDone
			endMs := time.Now().UnixMilli()
			statusMu.Lock()
			countsCopy := make(map[string]int64, len(statusCounts))
			for k, v := range statusCounts {
				countsCopy[k] = v
			}
			statusMu.Unlock()
			rtMu.Lock()
			respTimesCopy := append([]int64(nil), responseTimes...)
			rtMu.Unlock()

			res := loadTestResults{
				TotalRequests:       totalSent.Load(),
				SuccessfulRequests:  okSent.Load(),
				FailedRequests:      failedSent.Load(),
				FailureStatusCounts: countsCopy,
				ResponseTimesMs:     respTimesCopy,
				StartTimeMs:         startMs,
				EndTimeMs:           endMs,
				Cancelled:           false,
				Aborted:             aborted.Load(),
				AbortReason:         abortReason.Load().(string),
				PlannedDurationMs:   plannedDurationMs,
				Adaptive:            adaptive,
			}
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, loadTestDoneEventName, loadTestDonePayload{RequestID: requestID, Results: res})
			}
			return
		case <-progressTicker.C:
			emitProgress(false, false)
		}
	}
}

func normalizeLoadTestConfigGo(cfg loadTestConfig) (normalizedLoadTestConfig, error) {
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

	return normalizedLoadTestConfig{
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
	// Accept forms like: 250ms, 2s, 1.5m, 1h, or bare number as ms
	// time.ParseDuration doesn't accept bare numbers as ms, so handle that.
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
		frac := n
		if frac > 1 {
			frac = frac / 100
		}
		return clamp01(frac), true
	default:
		// JSON numbers sometimes arrive as float64; ignore other types.
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
		return int64(math.Max(1, math.Floor(t)))
	case string:
		ms := parseDurationMsGo(t)
		if ms > 0 {
			sec := int64(math.Round(float64(ms) / 1000))
			return maxInt64(1, sec)
		}
		if n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64); err == nil && n > 0 {
			return maxInt64(1, n)
		}
		return fallback
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
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
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
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		if s == "" {
			return false
		}
		switch s {
		case "1", "true", "yes", "y", "on", "enable", "enabled":
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func firstInt64(vals ...*int64) int64 {
	for _, v := range vals {
		if v != nil {
			return *v
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
	for _, r := range s {
		if (r < '0' || r > '9') && r != '.' {
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
