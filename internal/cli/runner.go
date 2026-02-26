package cli

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"regexp"
	"strings"
	"time"
)

// SecretResolver can retrieve secret values by environment and key.
type SecretResolver interface {
	GetSecret(env, key string) (string, error)
}

// Runner executes HTTP requests in CLI mode
type Runner struct {
	httpClient     *http.Client
	variables      map[string]string
	envVars        map[string]string
	verbose        bool
	noScripts      bool
	timeout        time.Duration
	version        string
	secretResolver SecretResolver
	environment    string
}

// NewRunner creates a new CLI runner
func NewRunner(opts *Options, version string) *Runner {
	return &Runner{
		httpClient: &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: false,
				},
			},
		},
		variables:   opts.Variables,
		envVars:     make(map[string]string),
		verbose:     opts.Verbose,
		noScripts:   opts.NoScripts,
		timeout:     time.Duration(opts.Timeout) * time.Second,
		version:     version,
		environment: opts.Environment,
	}
}

// ResponseResult holds the result of an HTTP request
type ResponseResult struct {
	RequestName  string            `json:"requestName,omitempty"`
	Method       string            `json:"method"`
	URL          string            `json:"url"`
	Status       int               `json:"status"`
	StatusText   string            `json:"statusText"`
	Headers      map[string]string `json:"headers"`
	Body         string            `json:"body"`
	ResponseTime int64             `json:"responseTime"`
	Timing       TimingInfo        `json:"timing"`
	Size         int64             `json:"size"`
	Error        string            `json:"error,omitempty"`
}

// TimingInfo contains request timing breakdown
type TimingInfo struct {
	DNSLookup       int64 `json:"dnsLookup"`
	TCPConnect      int64 `json:"tcpConnect"`
	TLSHandshake    int64 `json:"tlsHandshake"`
	TimeToFirstByte int64 `json:"timeToFirstByte"`
	ContentTransfer int64 `json:"contentTransfer"`
	Total           int64 `json:"total"`
}

// Run executes the CLI command
func Run(opts *Options, version string) int {
	switch opts.Command {
	case CommandVersion:
		PrintVersion(version)
		return 0
	case CommandHelp:
		PrintHelp(version)
		return 0
	case CommandList:
		return runList(opts)
	case CommandEnvs:
		return runEnvs(opts)
	case CommandRun:
		return runRequests(opts, version)
	default:
		PrintHelp(version)
		return 1
	}
}

func runList(opts *Options) int {
	content, err := os.ReadFile(opts.File)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %s\n", err)
		return 1
	}

	parsed := ParseHttpFile(string(content))
	summaries := parsed.ListRequests()

	if len(summaries) == 0 {
		fmt.Println("No requests found in file")
		return 0
	}

	fmt.Printf("Requests in %s:\n\n", opts.File)
	for _, s := range summaries {
		group := ""
		if s.Group != "" {
			group = fmt.Sprintf(" [%s]", s.Group)
		}
		fmt.Printf("  %d. %s %s %s%s\n", s.Index, s.Method, s.URL, s.Name, group)
	}
	return 0
}

func runEnvs(opts *Options) int {
	content, err := os.ReadFile(opts.File)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %s\n", err)
		return 1
	}

	parsed := ParseHttpFile(string(content))
	envs := parsed.ListEnvironments()

	if len(envs) == 0 {
		fmt.Println("No environments defined in file")
		return 0
	}

	fmt.Printf("Environments in %s:\n\n", opts.File)
	for _, env := range envs {
		vars := parsed.Environments[env]
		fmt.Printf("  %s:\n", env)
		for k, v := range vars {
			// Truncate long values
			display := v
			if len(display) > 50 {
				display = display[:47] + "..."
			}
			fmt.Printf("    %s = %s\n", k, display)
		}
	}
	return 0
}

func runRequests(opts *Options, version string) int {
	content, err := os.ReadFile(opts.File)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %s\n", err)
		return 1
	}

	parsed := ParseHttpFile(string(content))
	runner := NewRunner(opts, version)

	// Load global variables from file
	for k, v := range parsed.Variables {
		if _, exists := runner.variables[k]; !exists {
			runner.variables[k] = v
		}
	}

	// Load environment variables
	if envVars, ok := parsed.Environments[opts.Environment]; ok {
		runner.envVars = envVars
	} else if opts.Environment != "default" {
		fmt.Fprintf(os.Stderr, "Warning: environment '%s' not found, using default\n", opts.Environment)
	}

	// Find requests to execute
	requests := parsed.FindRequestsByName(opts.RequestNames)
	if len(requests) == 0 {
		if len(opts.RequestNames) > 0 {
			fmt.Fprintf(os.Stderr, "No requests found matching: %s\n", strings.Join(opts.RequestNames, ", "))
			return 1
		}
		fmt.Fprintf(os.Stderr, "No requests found in file\n")
		return 1
	}

	// Execute requests
	var results []ResponseResult
	hasError := false

	for _, req := range requests {
		result := runner.ExecuteRequest(req)
		results = append(results, result)

		if result.Error != "" {
			hasError = true
		}
		if result.Status >= 400 {
			hasError = true
		}
	}

	// Output results
	outputResults(results, opts.Output)

	if hasError {
		return 1
	}
	return 0
}

// ExecuteRequest performs a single HTTP request
func (r *Runner) ExecuteRequest(req Request) ResponseResult {
	result := ResponseResult{
		RequestName: req.Name,
		Method:      req.Method,
		Headers:     make(map[string]string),
	}

	// Resolve variables in URL
	url := r.resolveVariables(req.URL)
	result.URL = url

	// Resolve variables in headers
	headers := make(map[string]string)
	for k, v := range req.Headers {
		headers[k] = r.resolveVariables(v)
	}

	// Resolve variables in body
	body := r.resolveVariables(req.Body)

	if r.verbose {
		fmt.Fprintf(os.Stderr, "==> %s %s\n", req.Method, url)
		for k, v := range headers {
			fmt.Fprintf(os.Stderr, "    %s: %s\n", k, v)
		}
		if body != "" {
			fmt.Fprintf(os.Stderr, "    Body: %s\n", truncate(body, 100))
		}
	}

	// Create request
	ctx := context.Background()
	if r.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.timeout)
		defer cancel()
	}

	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, url, reqBody)
	if err != nil {
		result.Error = fmt.Sprintf("Error creating request: %s", err)
		return result
	}

	// Set headers
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	// Default headers
	if httpReq.Header.Get("User-Agent") == "" {
		httpReq.Header.Set("User-Agent", fmt.Sprintf("RawRequest/%s", r.version))
	}
	if body != "" && httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	// Timing
	var timing TimingInfo
	var dnsStart, dnsEnd, connectStart, connectEnd, tlsStart, tlsEnd, firstByteTime time.Time
	startTime := time.Now()

	trace := &httptrace.ClientTrace{
		DNSStart:             func(_ httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:              func(_ httptrace.DNSDoneInfo) { dnsEnd = time.Now() },
		ConnectStart:         func(_, _ string) { connectStart = time.Now() },
		ConnectDone:          func(_, _ string, _ error) { connectEnd = time.Now() },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(_ tls.ConnectionState, _ error) { tlsEnd = time.Now() },
		GotFirstResponseByte: func() { firstByteTime = time.Now() },
	}
	httpReq = httpReq.WithContext(httptrace.WithClientTrace(ctx, trace))

	// Execute request
	resp, err := r.httpClient.Do(httpReq)
	if err != nil {
		result.Error = fmt.Sprintf("Request failed: %s", err)
		return result
	}
	defer resp.Body.Close()

	// Read body
	contentStart := time.Now()
	respBody, err := io.ReadAll(resp.Body)
	contentEnd := time.Now()
	if err != nil {
		result.Error = fmt.Sprintf("Error reading response: %s", err)
		return result
	}

	// Calculate timing
	if !dnsStart.IsZero() && !dnsEnd.IsZero() {
		timing.DNSLookup = dnsEnd.Sub(dnsStart).Milliseconds()
	}
	if !connectStart.IsZero() && !connectEnd.IsZero() {
		timing.TCPConnect = connectEnd.Sub(connectStart).Milliseconds()
	}
	if !tlsStart.IsZero() && !tlsEnd.IsZero() {
		timing.TLSHandshake = tlsEnd.Sub(tlsStart).Milliseconds()
	}
	if !firstByteTime.IsZero() {
		timing.TimeToFirstByte = firstByteTime.Sub(startTime).Milliseconds()
	}
	timing.ContentTransfer = contentEnd.Sub(contentStart).Milliseconds()
	timing.Total = time.Since(startTime).Milliseconds()

	// Build result
	result.Status = resp.StatusCode
	result.StatusText = resp.Status
	result.ResponseTime = timing.Total
	result.Timing = timing
	result.Size = int64(len(respBody))
	result.Body = string(respBody)

	for k, v := range resp.Header {
		if len(v) > 0 {
			result.Headers[strings.ToLower(k)] = v[0]
		}
	}

	return result
}

func (r *Runner) resolveVariables(input string) string {
	result := input

	// Replace secrets: {{secret:KEY}}
	result = r.resolveSecrets(result)

	// Replace variables from CLI args and file
	for k, v := range r.variables {
		result = strings.ReplaceAll(result, "{{"+k+"}}", v)
	}

	// Replace environment variables
	for k, v := range r.envVars {
		result = strings.ReplaceAll(result, "{{"+k+"}}", v)
	}

	// Replace system environment variables
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			result = strings.ReplaceAll(result, "{{env."+parts[0]+"}}", parts[1])
		}
	}

	return result
}

var secretPattern = regexp.MustCompile(`\{\{\s*secret:([a-zA-Z0-9_\-\.]+)\s*\}\}`)

func (r *Runner) resolveSecrets(input string) string {
	if r.secretResolver == nil {
		return input
	}
	return secretPattern.ReplaceAllStringFunc(input, func(match string) string {
		sub := secretPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := sub[1]
		env := r.environment
		if env == "" {
			env = "default"
		}
		// Try environment-specific first, then fall back to default
		val, err := r.secretResolver.GetSecret(env, key)
		if err != nil && env != "default" {
			val, err = r.secretResolver.GetSecret("default", key)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: secret '%s' not found: %s\n", key, err)
			return match
		}
		return val
	})
}

// SetSecretResolver sets the secret resolver for {{secret:KEY}} placeholders.
func (r *Runner) SetSecretResolver(sr SecretResolver) {
	r.secretResolver = sr
}

// SetEnvironment sets the active environment name.
func (r *Runner) SetEnvironment(env string) {
	r.environment = env
}

// SetVariable sets a runtime variable.
func (r *Runner) SetVariable(key, value string) {
	r.variables[key] = value
}

// ResolveForTest exposes resolveVariables for testing.
func (r *Runner) ResolveForTest(input string) string {
	return r.resolveVariables(input)
}

func outputResults(results []ResponseResult, format OutputFormat) {
	switch format {
	case OutputQuiet:
		// No output
	case OutputBody:
		for i, r := range results {
			if i > 0 {
				fmt.Println("---")
			}
			fmt.Print(r.Body)
		}
	case OutputJSON:
		var output interface{}
		if len(results) == 1 {
			output = results[0]
		} else {
			output = results
		}
		data, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(data))
	case OutputFull:
		fallthrough
	default:
		for i, r := range results {
			if i > 0 {
				fmt.Println("\n---")
			}
			if r.RequestName != "" {
				fmt.Printf("Request: %s\n", r.RequestName)
			}
			if r.Error != "" {
				fmt.Printf("Error: %s\n", r.Error)
				continue
			}
			fmt.Printf("%s %s\n", r.Method, r.URL)
			fmt.Printf("Status: %s\n", r.StatusText)
			fmt.Printf("Time: %dms, Size: %d bytes\n", r.ResponseTime, r.Size)
			fmt.Println()
			if r.Body != "" {
				// Try to pretty print JSON
				var js interface{}
				if err := json.Unmarshal([]byte(r.Body), &js); err == nil {
					pretty, _ := json.MarshalIndent(js, "", "  ")
					fmt.Println(string(pretty))
				} else {
					fmt.Println(r.Body)
				}
			}
		}
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

func prettyJSON(data []byte) string {
	var buf bytes.Buffer
	if err := json.Indent(&buf, data, "", "  "); err != nil {
		return string(data)
	}
	return buf.String()
}
