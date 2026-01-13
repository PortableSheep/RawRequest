package main

import (
	"context"
	"math/rand"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	lt "rawrequest/internal/loadtest"
	"rawrequest/internal/loadtestbridge"
	lp "rawrequest/internal/loadtestpayload"
	"rawrequest/internal/loadtestrunlogic"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	loadTestProgressEventName = "loadtest:progress"
	loadTestDoneEventName     = "loadtest:done"
	loadTestErrorEventName    = "loadtest:error"
)

type loadTestResults struct {
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

func (a *App) StartLoadTest(requestID, method, url, headersJSON, body, loadConfigJSON string) error {
	requestID, method, url, err := loadtestbridge.NormalizeStartArgs(requestID, method, url)
	if err != nil {
		return err
	}

	norm, err := loadtestbridge.ParseAndNormalizeConfig(loadConfigJSON)
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

func (a *App) runLoadTest(ctx context.Context, _ context.CancelFunc, requestID, method, url, headersJSON, body string, cfg lt.NormalizedConfig) {
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

	var totalSent atomic.Int64
	var okSent atomic.Int64
	var failedSent atomic.Int64
	statusCounts := map[string]int64{}
	var statusMu sync.Mutex
	responseTimes := make([]int64, 0, 1024)
	var rtMu sync.Mutex

	window := lt.NewAdaptiveWindowRing(cfg.AdaptiveEnabled, cfg.AdaptiveWindowSec)

	adaptive := &lt.AdaptiveSummary{Enabled: cfg.AdaptiveEnabled}
	if cfg.AdaptiveEnabled {
		adaptive.Phase = "ramping"
	} else {
		adaptive.Phase = "disabled"
	}

	var allowedUsers atomic.Int64
	if cfg.AdaptiveEnabled {
		allowedUsers.Store(cfg.StartUsers)
	} else {
		allowedUsers.Store(cfg.MaxUsers)
	}

	limiter := (*lt.RpsLimiter)(nil)
	if cfg.HasRps {
		limiter = lt.NewRpsLimiter(start, cfg.RequestsPerSecond)
	}
	throttle := func() {
		if limiter == nil {
			return
		}
		wait := limiter.Reserve(time.Now())
		_ = lt.WaitOrStop(ctx, stopCh, wait, nil)
	}

	progressTicker := time.NewTicker(200 * time.Millisecond)
	defer progressTicker.Stop()
	emitProgress := func(force bool, done bool) {
		if a.ctx == nil {
			return
		}
		payload := lp.BuildProgressPayload(lp.ProgressInput{
			RequestID:         requestID,
			StartedAtMs:       startMs,
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
		})
		wailsruntime.EventsEmit(a.ctx, loadTestProgressEventName, payload)
		_ = force
	}

	worker := func(userNumber int64) {
		r := rand.New(rand.NewSource(time.Now().UnixNano() + userNumber*31))
		active := false
		defer func() {
			if active {
				activeUsers.Add(-1)
			}
		}()

		for {
			if ctx.Err() != nil || isStopped() {
				return
			}
			if aborted.Load() {
				return
			}
			if cfg.HasDuration && time.Now().After(stopAt) {
				return
			}

			allowed := allowedUsers.Load()
			if userNumber > allowed {
				if active {
					activeUsers.Add(-1)
					active = false
				}
				if !lt.WaitOrStop(ctx, stopCh, 200*time.Millisecond, nil) {
					return
				}
				continue
			}

			if !active {
				activeUsers.Add(1)
				active = true
			}

			if !reserveSlot() {
				return
			}

			throttle()
			if ctx.Err() != nil || isStopped() || aborted.Load() {
				return
			}

			res := a.performRequest(ctx, "", method, url, headersJSON, body, 0)
			if res == requestCancelledResponse {
				return
			}
			status, timingMs := lt.ParseStatusAndTiming(res)
			if timingMs <= 0 {
				timingMs = time.Since(start).Milliseconds()
			}

			totalSent.Add(1)
			rtMu.Lock()
			responseTimes = append(responseTimes, timingMs)
			rtMu.Unlock()

			isFailure := status == 0 || status >= 400
			window.Record(time.Now(), isFailure)
			if isFailure {
				failedSent.Add(1)
				statusMu.Lock()
				statusCounts[strconv.Itoa(status)]++
				statusMu.Unlock()
			} else {
				okSent.Add(1)
			}

			if !aborted.Load() {
				if shouldAbort, reason := lt.FailureRateAbortDecision(totalSent.Load(), failedSent.Load(), cfg.FailureThreshold, cfg.HasFailureThresh); shouldAbort {
					aborted.Store(true)
					abortReason.Store(reason)
				}
			}
			if aborted.Load() {
				return
			}

			wait := lt.UserWaitDuration(cfg.HasWaitRange, cfg.WaitMinMs, cfg.WaitMaxMs, cfg.DelayMs, r)
			if !lt.WaitOrStop(ctx, stopCh, wait, nil) {
				return
			}
		}
	}

	var usersWG sync.WaitGroup
	usersWG.Add(int(cfg.MaxUsers))
	for i := int64(1); i <= cfg.MaxUsers; i++ {
		userNumber := i
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

	remaining := cfg.MaxUsers - cfg.StartUsers
	allowRamping := atomic.Bool{}
	allowRamping.Store(true)
	spawnRate, hasSpawn := lt.DeriveSpawnRate(cfg.SpawnRate, cfg.HasSpawnRate, cfg.HasRampUp, cfg.RampUpMs, remaining)
	cfg.HasSpawnRate = hasSpawn

	controllerDone := make(chan struct{})
	go func() {
		defer close(controllerDone)
		if !cfg.AdaptiveEnabled {
			return
		}
		controller := lt.NewAdaptiveController()

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
			now := time.Now()
			sent, _, frPtr, rpsPtr := window.Stats(now)
			res := controller.Step(lt.AdaptiveControllerStepInput{
				Now:               now,
				StartedAt:         start,
				HasDuration:       cfg.HasDuration,
				StopAt:            stopAt,
				MaxUsers:          cfg.MaxUsers,
				AdaptiveFailure:   cfg.AdaptiveFailureRate,
				AdaptiveStableSec: cfg.AdaptiveStableSec,
				AdaptiveCooldown:  time.Duration(cfg.AdaptiveCooldownMs) * time.Millisecond,
				BackoffStepUsers:  cfg.AdaptiveBackoffStepUsers,
				AllowedUsers:      allowedUsers.Load(),
				WindowSent:        sent,
				WindowFR:          frPtr,
				WindowRPS:         rpsPtr,
			}, adaptive)
			if res.DisableRamping {
				allowRamping.Store(false)
			}
			if res.SetAllowedUsers != nil {
				allowedUsers.Store(*res.SetAllowedUsers)
			}
			if res.Abort {
				aborted.Store(true)
				abortReason.Store(res.AbortReason)
			}
			if res.Stop {
				stop()
				return
			}
		}
	}()

	go func() {
		if remaining <= 0 {
			return
		}
		if !cfg.HasSpawnRate || spawnRate <= 0 {
			allowedUsers.Store(cfg.MaxUsers)
			return
		}
		interval := loadtestrunlogic.ComputeSpawnInterval(spawnRate)
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
			cur := allowedUsers.Load()
			if cur < cfg.MaxUsers {
				allowedUsers.Store(cur + 1)
			}
			select {
			case <-ctx.Done():
				return
			case <-stopCh:
				return
			case <-time.After(interval):
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			emitProgress(true, true)
			<-controllerDone
			<-usersDone
			endMs := time.Now().UnixMilli()
			res := lp.BuildResults(lp.FinalizeInput{
				Ctx:               ctx,
				StartMs:           startMs,
				EndMs:             endMs,
				PlannedDurationMs: plannedDurationMs,
				Adaptive:          adaptive,
				Aborted:           &aborted,
				AbortReason:       &abortReason,
				TotalSent:         &totalSent,
				OkSent:            &okSent,
				FailedSent:        &failedSent,
				Cancelled:         true,
				StatusMu:          &statusMu,
				StatusCounts:      statusCounts,
				RtMu:              &rtMu,
				ResponseTimes:     responseTimes,
			})
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, loadTestDoneEventName, lp.DonePayload{RequestID: requestID, Results: res})
			}
			return
		case <-usersDone:
			emitProgress(true, true)
			<-controllerDone
			endMs := time.Now().UnixMilli()
			res := lp.BuildResults(lp.FinalizeInput{
				Ctx:               ctx,
				StartMs:           startMs,
				EndMs:             endMs,
				PlannedDurationMs: plannedDurationMs,
				Adaptive:          adaptive,
				Aborted:           &aborted,
				AbortReason:       &abortReason,
				TotalSent:         &totalSent,
				OkSent:            &okSent,
				FailedSent:        &failedSent,
				Cancelled:         false,
				StatusMu:          &statusMu,
				StatusCounts:      statusCounts,
				RtMu:              &rtMu,
				ResponseTimes:     responseTimes,
			})
			if a.ctx != nil {
				wailsruntime.EventsEmit(a.ctx, loadTestDoneEventName, lp.DonePayload{RequestID: requestID, Results: res})
			}
			return
		case <-progressTicker.C:
			emitProgress(false, false)
		}
	}
}
