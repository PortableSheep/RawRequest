package cli

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	hcl "rawrequest/internal/httpclientlogic"
	se "rawrequest/internal/scriptexec"
	sr "rawrequest/internal/scriptruntime"
)

// SecretResolver can retrieve secret values by environment and key.
type SecretResolver interface {
	GetSecret(env, key string) (string, error)
}

// ScriptLogEntry represents a single log entry from a script execution.
type ScriptLogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
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
	logCallback    func(level, source, message string)
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
	ScriptLogs   []ScriptLogEntry  `json:"scriptLogs,omitempty"`
	IsBinary     bool              `json:"isBinary,omitempty"`
	ContentType  string            `json:"contentType,omitempty"`
	rawBody      []byte            // raw bytes for binary responses (not serialised)
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
	case CommandLoad:
		return RunLoadTest(opts, version)
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

	// Wire up script log output for CLI
	runner.SetLogCallback(func(level, source, message string) {
		fmt.Fprintf(os.Stderr, "[%s] [%s] %s\n", source, level, message)
	})

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

	// Collect script logs during execution
	var scriptLogs []ScriptLogEntry
	appendLog := func(level, source, message string) {
		message = strings.TrimSpace(message)
		if message == "" {
			return
		}
		entry := ScriptLogEntry{
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			Level:     strings.ToLower(level),
			Source:    source,
			Message:   message,
		}
		scriptLogs = append(scriptLogs, entry)
		if r.logCallback != nil {
			r.logCallback(level, source, message)
		}
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

	// Execute pre-script
	var scriptCtx *sr.ExecutionContext
	if !r.noScripts && req.PreScript != "" {
		cleaned := cleanScript(req.PreScript)
		if cleaned != "" {
			scriptCtx = &sr.ExecutionContext{
				Request: map[string]interface{}{
					"method":  req.Method,
					"url":     url,
					"headers": headers,
					"body":    body,
					"name":    req.Name,
				},
				Variables: r.variablesSnapshot(),
			}
			se.Execute(cleaned, scriptCtx, "pre", se.Dependencies{
				VariablesSnapshot: r.variablesSnapshot,
				GetVar:            r.getVariable,
				SetVar:            r.SetVariable,
				AppendLog:         appendLog,
			})
			// Apply any request modifications from the pre-script
			if v, ok := scriptCtx.Request["url"].(string); ok {
				url = v
				result.URL = url
			}
			if v, ok := scriptCtx.Request["body"].(string); ok {
				body = v
			}
			if v, ok := scriptCtx.Request["method"].(string); ok {
				result.Method = v
				req.Method = v
			}
			if h := extractStringHeaders(scriptCtx.Request["headers"]); h != nil {
				headers = h
			}
		}
	}

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

	execResult, err := hcl.Execute(hcl.ExecuteInput{
		Context:               ctx,
		Method:                req.Method,
		URL:                   url,
		Headers:               headers,
		Body:                  reqBody,
		RawBody:               body,
		DefaultUserAgent:      fmt.Sprintf("RawRequest/%s", r.version),
		SetDefaultContentType: true,
		Client:                r.httpClient,
	})
	if err != nil {
		var execErr *hcl.ExecuteError
		if errors.As(err, &execErr) {
			switch execErr.Stage {
			case hcl.StageCreateRequest:
				result.Error = fmt.Sprintf("Error creating request: %s", execErr)
				result.ScriptLogs = scriptLogs
				return result
			case hcl.StageReadBody:
				result.Error = fmt.Sprintf("Error reading response: %s", execErr)
				result.ScriptLogs = scriptLogs
				return result
			default:
				result.Error = fmt.Sprintf("Request failed: %s", execErr)
				result.ScriptLogs = scriptLogs
				return result
			}
		}
		result.Error = fmt.Sprintf("Request failed: %s", err)
		result.ScriptLogs = scriptLogs
		return result
	}

	result.Status = execResult.StatusCode
	result.StatusText = execResult.StatusText
	result.ResponseTime = execResult.Timing.Total
	result.Timing = TimingInfo{
		DNSLookup:       execResult.Timing.DNSLookup,
		TCPConnect:      execResult.Timing.TCPConnect,
		TLSHandshake:    execResult.Timing.TLSHandshake,
		TimeToFirstByte: execResult.Timing.TimeToFirstByte,
		ContentTransfer: execResult.Timing.ContentTransfer,
		Total:           execResult.Timing.Total,
	}
	result.Size = execResult.Size
	result.Headers = execResult.ResponseHeaders

	// Detect binary content type
	respContentType := execResult.ResponseHeaders["content-type"]
	if hcl.IsBinaryContentType(respContentType) {
		result.IsBinary = true
		result.ContentType = respContentType
		result.rawBody = execResult.Body
		result.Body = fmt.Sprintf("[Binary response: %s, %d bytes]", respContentType, execResult.Size)
	} else {
		result.Body = string(execResult.Body)
	}

	// Execute post-script
	if !r.noScripts && req.PostScript != "" {
		cleaned := cleanScript(req.PostScript)
		if cleaned != "" {
			responseData := map[string]interface{}{
				"status":       execResult.StatusCode,
				"statusText":   execResult.StatusText,
				"headers":      execResult.ResponseHeaders,
				"body":         string(execResult.Body),
				"text":         string(execResult.Body),
				"responseTime": execResult.Timing.Total,
				"size":         execResult.Size,
			}
			var jsonData interface{}
			if json.Unmarshal(execResult.Body, &jsonData) == nil {
				responseData["json"] = jsonData
			}
			if scriptCtx == nil {
				scriptCtx = &sr.ExecutionContext{
					Request: map[string]interface{}{
						"method":  req.Method,
						"url":     url,
						"headers": headers,
						"body":    body,
						"name":    req.Name,
					},
				}
			}
			scriptCtx.Response = responseData
			scriptCtx.Variables = r.variablesSnapshot()
			se.Execute(cleaned, scriptCtx, "post", se.Dependencies{
				VariablesSnapshot: r.variablesSnapshot,
				GetVar:            r.getVariable,
				SetVar:            r.SetVariable,
				AppendLog:         appendLog,
			})
		}
	}

	result.ScriptLogs = scriptLogs
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

func (r *Runner) variablesSnapshot() map[string]string {
	snap := make(map[string]string, len(r.variables)+len(r.envVars))
	for k, v := range r.envVars {
		snap[k] = v
	}
	for k, v := range r.variables {
		snap[k] = v
	}
	return snap
}

func (r *Runner) getVariable(key string) (string, bool) {
	if v, ok := r.variables[key]; ok {
		return v, true
	}
	if v, ok := r.envVars[key]; ok {
		return v, true
	}
	return "", false
}

// GetVariables returns the current runner variables.
func (r *Runner) GetVariables() map[string]string {
	return r.variables
}

// ResolveForTest exposes resolveVariables for testing.
func (r *Runner) ResolveForTest(input string) string {
	return r.resolveVariables(input)
}

// SetLogCallback sets the callback for script log output.
func (r *Runner) SetLogCallback(fn func(level, source, message string)) {
	r.logCallback = fn
}

// cleanScript strips script block markers (< { ... } or > { ... }).
func cleanScript(script string) string {
	lines := strings.Split(script, "\n")
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	if first := strings.TrimSpace(lines[0]); strings.HasPrefix(first, "<") || strings.HasPrefix(first, ">") {
		lines = lines[1:]
	}
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	if strings.TrimSpace(lines[len(lines)-1]) == "}" {
		lines = lines[:len(lines)-1]
	}
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

func trimScriptEdges(lines []string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// extractStringHeaders converts headers from a script context (which may be
// map[string]interface{} or map[string]string) back into map[string]string.
func extractStringHeaders(v interface{}) map[string]string {
	switch h := v.(type) {
	case map[string]string:
		return h
	case map[string]interface{}:
		out := make(map[string]string, len(h))
		for k, val := range h {
			if s, ok := val.(string); ok {
				out[k] = s
			}
		}
		return out
	}
	return nil
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
			if r.IsBinary && r.rawBody != nil {
				// Write raw bytes to stdout (pipe-friendly)
				os.Stdout.Write(r.rawBody)
			} else {
				fmt.Print(r.Body)
			}
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
			if r.IsBinary {
				fmt.Printf("[Binary response: %s, %s]\n",
					r.ContentType,
					formatBinarySize(r.Size))
			} else if r.Body != "" {
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

func formatBinarySize(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB"}
	k := float64(1024)
	size := float64(bytes)
	i := 0
	for size >= k && i < len(units)-1 {
		size /= k
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d B", bytes)
	}
	return fmt.Sprintf("%.1f %s", size, units[i])
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
