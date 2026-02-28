package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"sort"
	"strings"
	"time"
)

// RunLoadTest executes a load test via the service backend.
func RunLoadTest(opts *Options, version string) int {
	if len(opts.RequestNames) == 0 {
		fmt.Fprintln(os.Stderr, "Error: --name is required for load tests")
		return 1
	}

	content, err := os.ReadFile(opts.File)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %s\n", err)
		return 1
	}

	parsed := ParseHttpFile(string(content))
	requests := parsed.FindRequestsByName(opts.RequestNames[:1])
	if len(requests) == 0 {
		fmt.Fprintf(os.Stderr, "Error: no request found with name '%s'\n", opts.RequestNames[0])
		return 1
	}

	req := requests[0]

	// Build runner for variable resolution
	runner := NewRunner(opts, version)
	for k, v := range parsed.Variables {
		if _, exists := opts.Variables[k]; !exists {
			runner.SetVariable(k, v)
		}
	}
	if envVars, ok := parsed.Environments[opts.Environment]; ok {
		for k, v := range envVars {
			runner.SetVariable(k, v)
		}
	}

	// Resolve URL and headers
	resolvedURL := runner.resolveVariables(req.URL)
	headersMap := make(map[string]string)
	for k, v := range req.Headers {
		headersMap[k] = runner.resolveVariables(v)
	}
	headersJSON, _ := json.Marshal(headersMap)
	resolvedBody := runner.resolveVariables(req.Body)

	// Build load config
	loadConfig := buildLoadConfig(opts)
	loadConfigJSON, _ := json.Marshal(loadConfig)

	// Ensure service is running
	serviceURL := fmt.Sprintf("http://%s", opts.ServiceAddr)
	if err := ensureServiceRunning(serviceURL); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return 1
	}

	requestID := fmt.Sprintf("cli-load-%d", time.Now().UnixNano())

	// Set up signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	go func() {
		<-sigCh
		cancelLoadTest(serviceURL, requestID)
		cancel()
	}()

	// Start SSE listener before starting load test
	resultCh := make(chan *loadTestDonePayload, 1)
	errCh := make(chan error, 1)
	go streamLoadTestEvents(ctx, serviceURL, requestID, opts.Output, resultCh, errCh)

	// Small delay to ensure SSE connection is established
	time.Sleep(100 * time.Millisecond)

	// Start load test
	payload := map[string]interface{}{
		"requestId":      requestID,
		"method":         req.Method,
		"url":            resolvedURL,
		"headersJson":    string(headersJSON),
		"body":           resolvedBody,
		"loadConfigJson": string(loadConfigJSON),
	}
	payloadJSON, _ := json.Marshal(payload)

	resp, err := http.Post(serviceURL+"/v1/start-load-test", "application/json", strings.NewReader(string(payloadJSON)))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error starting load test: %s\n", err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		fmt.Fprintf(os.Stderr, "Error starting load test: HTTP %d\n", resp.StatusCode)
		return 1
	}

	if opts.Output == OutputFull {
		fmt.Fprintf(os.Stderr, "Load test started: %s %s\n", req.Method, resolvedURL)
		fmt.Fprintf(os.Stderr, "Users: %d | Duration: %s | Ctrl+C to cancel\n\n", opts.LoadUsers, opts.LoadDuration)
	}

	// Wait for completion
	select {
	case result := <-resultCh:
		if result != nil {
			printLoadTestSummary(result, opts.Output)
			if result.Results.Aborted {
				return 1
			}
		}
		return 0
	case err := <-errCh:
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		return 1
	case <-ctx.Done():
		fmt.Fprintln(os.Stderr, "\nLoad test cancelled.")
		return 1
	}
}

type loadConfig struct {
	Concurrent  int     `json:"concurrent,omitempty"`
	Duration    string  `json:"duration,omitempty"`
	Rps         int     `json:"rps,omitempty"`
	RampUp      string  `json:"rampUp,omitempty"`
	FailureRate float64 `json:"failureRate,omitempty"`
	Adaptive    bool    `json:"adaptive,omitempty"`
}

func buildLoadConfig(opts *Options) loadConfig {
	cfg := loadConfig{
		Concurrent: opts.LoadUsers,
		Duration:   opts.LoadDuration,
	}
	if opts.LoadRPS > 0 {
		cfg.Rps = opts.LoadRPS
	}
	if opts.LoadRampUp != "" {
		cfg.RampUp = opts.LoadRampUp
	}
	if opts.LoadFailRate > 0 {
		cfg.FailureRate = opts.LoadFailRate
	}
	if opts.LoadAdaptive {
		cfg.Adaptive = true
	}
	return cfg
}

func ensureServiceRunning(serviceURL string) error {
	client := &http.Client{Timeout: 750 * time.Millisecond}
	resp, err := client.Get(serviceURL + "/v1/health")
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return nil
		}
	}

	// Try to start service
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}

	// Extract host:port from URL
	addr := strings.TrimPrefix(serviceURL, "http://")
	addr = strings.TrimPrefix(addr, "https://")

	cmd := exec.Command(exePath, "service", "--addr", addr)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start service: %w", err)
	}

	// Wait for health
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(serviceURL + "/v1/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	return fmt.Errorf("service failed to start at %s", serviceURL)
}

func cancelLoadTest(serviceURL, requestID string) {
	payload, _ := json.Marshal(map[string]string{"requestId": requestID})
	resp, err := http.Post(serviceURL+"/v1/cancel-request", "application/json", strings.NewReader(string(payload)))
	if err == nil {
		resp.Body.Close()
	}
}

type loadTestProgress struct {
	RequestID   string `json:"requestId"`
	Type        string `json:"type"`
	StartedAt   int64  `json:"startedAt"`
	ActiveUsers int64  `json:"activeUsers"`
	MaxUsers    int64  `json:"maxUsers"`
	TotalSent   int64  `json:"totalSent"`
	Successful  int64  `json:"successful"`
	Failed      int64  `json:"failed"`
	Done        bool   `json:"done"`
	Cancelled   bool   `json:"cancelled"`
	Aborted     bool   `json:"aborted"`
	AbortReason string `json:"abortReason"`
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

type adaptiveSummary struct {
	Enabled     bool   `json:"enabled"`
	Phase       string `json:"phase"`
	Stabilized  *bool  `json:"stabilized,omitempty"`
	PeakUsers   *int64 `json:"peakUsers,omitempty"`
	StableUsers *int64 `json:"stableUsers,omitempty"`
}

type loadTestDonePayload struct {
	RequestID string          `json:"requestId"`
	Results   loadTestResults `json:"results"`
}

type sseEvent struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

func streamLoadTestEvents(ctx context.Context, serviceURL, requestID string, output OutputFormat, resultCh chan<- *loadTestDonePayload, errCh chan<- error) {
	req, err := http.NewRequestWithContext(ctx, "GET", serviceURL+"/v1/events", nil)
	if err != nil {
		errCh <- err
		return
	}

	client := &http.Client{Timeout: 0} // No timeout for SSE
	resp, err := client.Do(req)
	if err != nil {
		errCh <- fmt.Errorf("failed to connect to event stream: %w", err)
		return
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var lastProgressLine string

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		var evt sseEvent
		if err := json.Unmarshal([]byte(data), &evt); err != nil {
			continue
		}

		switch evt.Event {
		case "loadtest:progress":
			var progress loadTestProgress
			if err := json.Unmarshal(evt.Payload, &progress); err != nil {
				continue
			}
			if progress.RequestID != requestID {
				continue
			}
			if output == OutputFull {
				elapsed := time.Since(time.UnixMilli(progress.StartedAt))
				progressLine := fmt.Sprintf("\rUsers: %d/%d | Sent: %d | OK: %d | Failed: %d | Elapsed: %s",
					progress.ActiveUsers, progress.MaxUsers,
					progress.TotalSent, progress.Successful, progress.Failed,
					formatDuration(elapsed))
				if progress.Aborted {
					progressLine += " [ABORTED]"
				}
				// Clear previous line and write new one
				clearLen := len(lastProgressLine)
				if len(progressLine) < clearLen {
					progressLine += strings.Repeat(" ", clearLen-len(progressLine))
				}
				fmt.Fprint(os.Stderr, progressLine)
				lastProgressLine = progressLine
			}

		case "loadtest:done":
			if output == OutputFull && lastProgressLine != "" {
				fmt.Fprintln(os.Stderr)
			}
			var done loadTestDonePayload
			if err := json.Unmarshal(evt.Payload, &done); err != nil {
				errCh <- fmt.Errorf("failed to parse load test results: %w", err)
				return
			}
			if done.RequestID != requestID {
				continue
			}
			resultCh <- &done
			return

		case "loadtest:error":
			if output == OutputFull && lastProgressLine != "" {
				fmt.Fprintln(os.Stderr)
			}
			var errPayload struct {
				RequestID string `json:"requestId"`
				Message   string `json:"message"`
			}
			if err := json.Unmarshal(evt.Payload, &errPayload); err != nil {
				continue
			}
			if errPayload.RequestID != requestID {
				continue
			}
			errCh <- fmt.Errorf("load test error: %s", errPayload.Message)
			return
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		errCh <- fmt.Errorf("event stream error: %w", err)
	}
}

func printLoadTestSummary(done *loadTestDonePayload, output OutputFormat) {
	r := done.Results

	if output == OutputJSON {
		data, _ := json.MarshalIndent(r, "", "  ")
		fmt.Println(string(data))
		return
	}

	if output == OutputQuiet {
		return
	}

	// Full output
	duration := time.Duration(r.EndTimeMs-r.StartTimeMs) * time.Millisecond
	fmt.Println()

	if r.Cancelled {
		fmt.Println("⚠ Load test cancelled")
	} else if r.Aborted {
		fmt.Printf("⚠ Load test aborted: %s\n", r.AbortReason)
	} else {
		fmt.Println("✓ Load test completed")
	}

	fmt.Printf("  Duration:    %s\n", formatDuration(duration))
	fmt.Println()

	// Request summary
	fmt.Println("  Requests:")
	fmt.Printf("    Total:       %d\n", r.TotalRequests)
	if r.TotalRequests > 0 {
		successRate := float64(r.SuccessfulRequests) / float64(r.TotalRequests) * 100
		fmt.Printf("    Successful:  %d (%.1f%%)\n", r.SuccessfulRequests, successRate)
		fmt.Printf("    Failed:      %d (%.1f%%)\n", r.FailedRequests, 100-successRate)
	}

	// RPS
	if duration.Seconds() > 0 {
		rps := float64(r.TotalRequests) / duration.Seconds()
		fmt.Printf("    RPS:         %.1f\n", rps)
	}
	fmt.Println()

	// Response times
	if len(r.ResponseTimesMs) > 0 {
		sorted := make([]int64, len(r.ResponseTimesMs))
		copy(sorted, r.ResponseTimesMs)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

		fmt.Println("  Response Times:")
		fmt.Printf("    Min:         %dms\n", sorted[0])
		fmt.Printf("    Avg:         %dms\n", avg(sorted))
		fmt.Printf("    P50:         %dms\n", percentile(sorted, 50))
		fmt.Printf("    P95:         %dms\n", percentile(sorted, 95))
		fmt.Printf("    P99:         %dms\n", percentile(sorted, 99))
		fmt.Printf("    Max:         %dms\n", sorted[len(sorted)-1])
		fmt.Println()
	}

	// Failure breakdown
	if len(r.FailureStatusCounts) > 0 {
		fmt.Println("  Failure Breakdown:")
		for status, count := range r.FailureStatusCounts {
			pct := float64(count) / float64(r.TotalRequests) * 100
			fmt.Printf("    HTTP %s:     %d (%.1f%%)\n", status, count, pct)
		}
		fmt.Println()
	}

	// Adaptive summary
	if r.Adaptive != nil && r.Adaptive.Enabled {
		fmt.Println("  Adaptive Control:")
		fmt.Printf("    Phase:       %s\n", r.Adaptive.Phase)
		if r.Adaptive.PeakUsers != nil {
			fmt.Printf("    Peak Users:  %d\n", *r.Adaptive.PeakUsers)
		}
		if r.Adaptive.StableUsers != nil {
			fmt.Printf("    Stable Users: %d\n", *r.Adaptive.StableUsers)
		}
		if r.Adaptive.Stabilized != nil {
			fmt.Printf("    Stabilized:  %v\n", *r.Adaptive.Stabilized)
		}
		fmt.Println()
	}
}

func formatDuration(d time.Duration) string {
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}
	if d < time.Minute {
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
	m := int(d.Minutes())
	s := int(d.Seconds()) % 60
	return fmt.Sprintf("%dm%ds", m, s)
}

func avg(sorted []int64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	var sum int64
	for _, v := range sorted {
		sum += v
	}
	return sum / int64(len(sorted))
}

func percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}
