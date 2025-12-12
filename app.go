//go:generate go run ./scripts/generate_script_cleaner.go

package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TimingBreakdown contains detailed timing information for an HTTP request
type TimingBreakdown struct {
	DNSLookup       int64 `json:"dnsLookup"`       // DNS resolution time in ms
	TCPConnect      int64 `json:"tcpConnect"`      // TCP connection time in ms
	TLSHandshake    int64 `json:"tlsHandshake"`    // TLS handshake time in ms
	TimeToFirstByte int64 `json:"timeToFirstByte"` // Time to first response byte in ms
	ContentTransfer int64 `json:"contentTransfer"` // Content download time in ms
	Total           int64 `json:"total"`           // Total request time in ms
}

// ResponseMetadata contains additional response information
type ResponseMetadata struct {
	Timing  TimingBreakdown   `json:"timing"`
	Size    int64             `json:"size"`    // Response body size in bytes
	Headers map[string]string `json:"headers"` // Response headers
}

// WindowState stores the window position and size
type WindowState struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

// App struct
type App struct {
	ctx             context.Context
	variables       map[string]string
	environments    map[string]map[string]string
	currentEnv      string
	requestCancels  map[string]context.CancelFunc
	cancelMutex     sync.Mutex
	scriptLogs      []ScriptLogEntry
	scriptLogMutex  sync.Mutex
	secretVault     *SecretVault
	secretVaultOnce sync.Once
	secretVaultErr  error
}

const (
	requestCancelledResponse = "__CANCELLED__"
	scriptLogEventName       = "script-log"
	maxScriptLogs            = 500
)

type ScriptLogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		variables:      make(map[string]string),
		environments:   make(map[string]map[string]string),
		currentEnv:     "default",
		requestCancels: make(map[string]context.CancelFunc),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// a.LoadData()
}

// onDomReady is called when the frontend DOM is ready
func (a *App) onDomReady(ctx context.Context) {
	// Restore window state after DOM is ready (ensures window functions work)
	a.RestoreWindowState()
}

// onBeforeClose is called when the window is about to close
func (a *App) onBeforeClose(ctx context.Context) bool {
	// Save window state before closing
	_ = a.SaveWindowState()
	return false // Allow close
}

// Secret management API -----------------------------------------------------

func (a *App) ListSecrets() (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.ListSecrets()
}

func (a *App) SaveSecret(env, key, value string) (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.StoreSecret(env, key, value)
}

func (a *App) DeleteSecret(env, key string) (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.RemoveSecret(env, key)
}

func (a *App) GetSecretValue(env, key string) (string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return "", err
	}
	return vault.GetSecret(env, key)
}

func (a *App) GetVaultInfo() (*VaultInfo, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.Info()
}

func (a *App) ResetVault() (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	if err := vault.Reset(); err != nil {
		return nil, err
	}
	return map[string][]string{}, nil
}

func (a *App) ExportSecrets() (map[string]map[string]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.Export()
}

func (a *App) getSecretVault() (*SecretVault, error) {
	a.secretVaultOnce.Do(func() {
		configDir, err := os.UserConfigDir()
		if err != nil || configDir == "" {
			configDir = os.TempDir()
		}
		appDir := filepath.Join(configDir, "rawrequest", "secrets")
		vault, err := NewSecretVault(appDir)
		if err != nil {
			a.secretVaultErr = err
			return
		}
		a.secretVault = vault
	})
	return a.secretVault, a.secretVaultErr
}

// Greet returns a greeting for the given name
// func (a *App) Greet(name string) string {
// 	return fmt.Sprintf("Hello %s, It's show time!", name)
// }

// SendRequest sends an HTTP request
func (a *App) SendRequest(method, url, headersJson, body string) string {
	return a.performRequest(context.Background(), method, url, headersJson, body, 0)
}

// SendRequestWithID sends an HTTP request that can be cancelled via requestID
func (a *App) SendRequestWithID(requestID, method, url, headersJson, body string) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, method, url, headersJson, body, 0)
}

// SendRequestWithTimeout sends an HTTP request with a per-request timeout (in milliseconds)
func (a *App) SendRequestWithTimeout(requestID, method, url, headersJson, body string, timeoutMs int) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, method, url, headersJson, body, timeoutMs)
}

func (a *App) performRequest(ctx context.Context, method, url, headersJson, body string, timeoutMs int) string {
	var headers map[string]string
	if headersJson != "" {
		json.Unmarshal([]byte(headersJson), &headers)
	}

	var reqBody io.Reader
	var contentType string

	// Check if this is a file upload request
	if strings.Contains(body, "Content-Type: multipart/form-data") || strings.Contains(body, "< ") {
		// Handle file upload
		if strings.HasPrefix(strings.TrimSpace(body), "< ") {
			filePath := strings.TrimPrefix(strings.TrimSpace(body), "< ")
			if fileContent, err := os.ReadFile(filePath); err == nil {
				reqBody = strings.NewReader(string(fileContent))
			} else {
				return fmt.Sprintf("Error reading file: %s", err)
			}
		} else {
			reqBody = strings.NewReader(body)
		}
	} else {
		reqBody = strings.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}

	// Set Content-Type if specified in headers
	for k, v := range headers {
		if strings.ToLower(k) == "content-type" {
			contentType = v
		}
		req.Header.Set(k, v)
	}

	// If no Content-Type specified and body exists, set default
	if contentType == "" && body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	// Timing variables
	var dnsStart, dnsEnd time.Time
	var connectStart, connectEnd time.Time
	var tlsStart, tlsEnd time.Time
	var gotFirstByte time.Time
	requestStart := time.Now()

	// Create httptrace to capture timing
	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) {
			dnsStart = time.Now()
		},
		DNSDone: func(_ httptrace.DNSDoneInfo) {
			dnsEnd = time.Now()
		},
		ConnectStart: func(_, _ string) {
			connectStart = time.Now()
		},
		ConnectDone: func(_, _ string, _ error) {
			connectEnd = time.Now()
		},
		TLSHandshakeStart: func() {
			tlsStart = time.Now()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			tlsEnd = time.Now()
		},
		GotFirstResponseByte: func() {
			gotFirstByte = time.Now()
		},
	}

	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))

	// Apply timeout if specified
	client := &http.Client{}
	if timeoutMs > 0 {
		client.Timeout = time.Duration(timeoutMs) * time.Millisecond
	}

	resp, err := client.Do(req)
	contentDownloadStart := time.Now()
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() == context.Canceled {
			return requestCancelledResponse
		}
		// Check for timeout
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "timeout") {
			return fmt.Sprintf("Error: Request timeout after %dms", timeoutMs)
		}
		return fmt.Sprintf("Error: %s", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	contentDownloadEnd := time.Now()
	if err != nil {
		return fmt.Sprintf("Error reading body: %s", err)
	}
	requestEnd := time.Now()

	// Calculate timing breakdown
	timing := TimingBreakdown{
		Total: requestEnd.Sub(requestStart).Milliseconds(),
	}
	if !dnsEnd.IsZero() && !dnsStart.IsZero() {
		timing.DNSLookup = dnsEnd.Sub(dnsStart).Milliseconds()
	}
	if !connectEnd.IsZero() && !connectStart.IsZero() {
		timing.TCPConnect = connectEnd.Sub(connectStart).Milliseconds()
	}
	if !tlsEnd.IsZero() && !tlsStart.IsZero() {
		timing.TLSHandshake = tlsEnd.Sub(tlsStart).Milliseconds()
	}
	if !gotFirstByte.IsZero() {
		timing.TimeToFirstByte = gotFirstByte.Sub(requestStart).Milliseconds()
	}
	timing.ContentTransfer = contentDownloadEnd.Sub(contentDownloadStart).Milliseconds()

	// Collect response headers
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[strings.ToLower(key)] = values[0]
		}
	}

	// Build response metadata
	metadata := ResponseMetadata{
		Timing:  timing,
		Size:    int64(len(respBody)),
		Headers: respHeaders,
	}
	metadataJSON, _ := json.Marshal(metadata)

	return fmt.Sprintf("Status: %s\nHeaders: %s\nBody: %s", resp.Status, string(metadataJSON), string(respBody))
}

// ParseHttp parses .http content and returns the request details
func (a *App) ParseHttp(content string, variables map[string]string, envVars map[string]string) []map[string]interface{} {
	// First pass: Replace simple variables and env vars
	for key, value := range variables {
		content = strings.ReplaceAll(content, "{{"+key+"}}", value)
	}
	for key, value := range envVars {
		content = strings.ReplaceAll(content, "{{"+key+"}}", value)
	}

	// Replace environment variables from system
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			content = strings.ReplaceAll(content, "{{env."+parts[0]+"}}", parts[1])
		}
	}

	lines := strings.Split(content, "\n")
	var requests []map[string]interface{}
	var currentRequest map[string]interface{}
	var currentBody strings.Builder
	inBody := false
	inHeaders := false
	var currentGroup string
	var preScript strings.Builder
	var postScript strings.Builder
	var assertions []string
	inPreScript := false
	inPostScript := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if inHeaders && !inBody && !inPreScript && !inPostScript {
				inBody = true
			}
			continue
		}

		// Handle request groups
		if strings.HasPrefix(trimmed, "###") {
			if strings.Contains(trimmed, "# @group") {
				currentGroup = strings.TrimSpace(strings.TrimPrefix(trimmed, "### @group"))
				continue
			}

			// New request
			if currentRequest != nil {
				bodyStr := strings.TrimSpace(currentBody.String())
				if strings.HasPrefix(bodyStr, "< ") {
					filePath := strings.TrimPrefix(bodyStr, "< ")
					if content, err := os.ReadFile(filePath); err == nil {
						currentRequest["body"] = string(content)
						currentRequest["isFile"] = true
					} else {
						currentRequest["body"] = bodyStr
					}
				} else {
					currentRequest["body"] = bodyStr
				}
				if currentGroup != "" {
					currentRequest["group"] = currentGroup
				}
				if preScript.Len() > 0 {
					currentRequest["preScript"] = strings.TrimSpace(preScript.String())
					preScript.Reset()
				}
				if postScript.Len() > 0 {
					currentRequest["postScript"] = strings.TrimSpace(postScript.String())
					postScript.Reset()
				}
				if len(assertions) > 0 {
					currentRequest["assertions"] = assertions
					assertions = nil
				}
				requests = append(requests, currentRequest)
			}
			currentRequest = make(map[string]interface{})
			currentBody.Reset()
			inBody = false
			inHeaders = false
			inPreScript = false
			inPostScript = false
			continue
		}

		// Handle pre-request scripts
		if strings.HasPrefix(trimmed, "### @pre") || strings.HasPrefix(trimmed, "<%") {
			inPreScript = true
			inHeaders = false
			inBody = false
			inPostScript = false
			if strings.HasPrefix(trimmed, "<%") {
				preScript.WriteString(strings.TrimPrefix(trimmed, "<%") + "\n")
			}
			continue
		}
		if inPreScript {
			if strings.HasPrefix(trimmed, "%>") {
				inPreScript = false
			} else {
				preScript.WriteString(line + "\n")
			}
			continue
		}

		// Handle post-response scripts
		if strings.HasPrefix(trimmed, "### @post") || strings.HasPrefix(trimmed, "<%") {
			inPostScript = true
			inHeaders = false
			inBody = false
			inPreScript = false
			if strings.HasPrefix(trimmed, "<%") {
				postScript.WriteString(strings.TrimPrefix(trimmed, "<%") + "\n")
			}
			continue
		}
		if inPostScript {
			if strings.HasPrefix(trimmed, "%>") {
				inPostScript = false
			} else {
				postScript.WriteString(line + "\n")
			}
			continue
		}

		// Handle assertions
		if strings.HasPrefix(trimmed, "### Assert") || strings.HasPrefix(trimmed, "### @assert") {
			assertion := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(trimmed, "### Assert"), "### @assert"))
			assertions = append(assertions, assertion)
			continue
		}

		if currentRequest == nil {
			currentRequest = make(map[string]interface{})
		}
		if !inHeaders && !inBody && strings.Contains(trimmed, " ") && (strings.HasPrefix(trimmed, "GET ") || strings.HasPrefix(trimmed, "POST ") || strings.HasPrefix(trimmed, "PUT ") || strings.HasPrefix(trimmed, "DELETE ") || strings.HasPrefix(trimmed, "PATCH ") || strings.HasPrefix(trimmed, "HEAD ") || strings.HasPrefix(trimmed, "OPTIONS ")) {
			parts := strings.Fields(trimmed)
			if len(parts) >= 2 {
				currentRequest["method"] = parts[0]
				currentRequest["url"] = parts[1]
			}
			inHeaders = true
		} else if inHeaders && !inBody && strings.Contains(trimmed, ":") {
			if currentRequest["headers"] == nil {
				currentRequest["headers"] = make(map[string]string)
			}
			headers := currentRequest["headers"].(map[string]string)
			if idx := strings.Index(trimmed, ":"); idx > 0 {
				key := strings.TrimSpace(trimmed[:idx])
				value := strings.TrimSpace(trimmed[idx+1:])
				headers[key] = value
			}
		} else {
			inBody = true
			currentBody.WriteString(line + "\n")
		}
	}
	if currentRequest != nil {
		bodyStr := strings.TrimSpace(currentBody.String())
		if strings.HasPrefix(bodyStr, "< ") {
			filePath := strings.TrimPrefix(bodyStr, "< ")
			if content, err := os.ReadFile(filePath); err == nil {
				currentRequest["body"] = string(content)
				currentRequest["isFile"] = true
			} else {
				currentRequest["body"] = bodyStr
			}
		} else {
			currentRequest["body"] = bodyStr
		}
		if currentGroup != "" {
			currentRequest["group"] = currentGroup
		}
		if preScript.Len() > 0 {
			currentRequest["preScript"] = strings.TrimSpace(preScript.String())
		}
		if postScript.Len() > 0 {
			currentRequest["postScript"] = strings.TrimSpace(postScript.String())
		}
		if len(assertions) > 0 {
			currentRequest["assertions"] = assertions
		}
		requests = append(requests, currentRequest)
	}

	return requests
}

// SetVariable sets a variable
func (a *App) SetVariable(key, value string) {
	a.variables[key] = value
	// a.SaveData()
}

// GetVariable gets a variable
func (a *App) GetVariable(key string) string {
	return a.variables[key]
}

// SetEnvironment sets the current environment
func (a *App) SetEnvironment(env string) {
	a.currentEnv = env
	if _, exists := a.environments[env]; !exists {
		a.environments[env] = make(map[string]string)
	}
	// a.SaveData()
}

// SetEnvVariable sets a variable in the current environment
func (a *App) SetEnvVariable(key, value string) {
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	// a.SaveData()
}

// GetEnvironments returns all environments
func (a *App) GetEnvironments() map[string]map[string]string {
	return a.environments
}

// GetVariables returns all variables
func (a *App) GetVariables() map[string]string {
	return a.variables
}

// GetEnvVariables returns variables for a specific environment
func (a *App) GetEnvVariables(env string) map[string]string {
	if vars, exists := a.environments[env]; exists {
		return vars
	}
	return make(map[string]string)
}

// AddEnvVariable adds a variable to the current environment
func (a *App) AddEnvVariable(key, value string) {
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	// a.SaveData()
}

// RenameEnvironment renames an environment
func (a *App) RenameEnvironment(oldName, newName string) {
	if vars, exists := a.environments[oldName]; exists {
		a.environments[newName] = vars
		delete(a.environments, oldName)
		if a.currentEnv == oldName {
			a.currentEnv = newName
		}
		// a.SaveData()
	}
}

// ExecuteRequests executes multiple requests with chaining
func (a *App) ExecuteRequests(requests []map[string]interface{}) string {
	return a.executeRequestsWithContext(context.Background(), requests)
}

// ExecuteRequestsWithID executes chained requests that can be cancelled via requestID
func (a *App) ExecuteRequestsWithID(requestID string, requests []map[string]interface{}) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.executeRequestsWithContext(ctx, requests)
}

func (a *App) executeRequestsWithContext(ctx context.Context, requests []map[string]interface{}) string {
	var results []string
	responseStore := make(map[string]map[string]interface{})

	for i, req := range requests {
		if ctx.Err() == context.Canceled {
			return requestCancelledResponse
		}

		method, ok := req["method"].(string)
		if !ok {
			continue
		}
		url, ok := req["url"].(string)
		if !ok {
			continue
		}

		headers := map[string]string{}
		if rawHeaders, exists := req["headers"]; exists {
			switch h := rawHeaders.(type) {
			case map[string]string:
				headers = h
			case map[string]interface{}:
				for key, value := range h {
					if strVal, ok := value.(string); ok {
						headers[key] = strVal
					}
				}
			}
		}

		body, _ := req["body"].(string)

		url = a.resolveResponseReferences(url, responseStore)
		body = a.resolveResponseReferences(body, responseStore)

		// Extract timeout from request options
		timeoutMs := 0
		if options, exists := req["options"].(map[string]interface{}); exists {
			if timeout, ok := options["timeout"].(float64); ok {
				timeoutMs = int(timeout)
			} else if timeout, ok := options["timeout"].(int); ok {
				timeoutMs = timeout
			}
		}

		if preScript, exists := req["preScript"].(string); exists && preScript != "" {
			a.executeScript(preScript, &scriptExecutionContext{
				Request:       req,
				Variables:     a.variables,
				ResponseStore: responseStore,
			}, "pre")
			if ctx.Err() == context.Canceled {
				return requestCancelledResponse
			}
		}

		headersJSON, _ := json.Marshal(headers)
		result := a.performRequest(ctx, method, url, string(headersJSON), body, timeoutMs)
		if result == requestCancelledResponse {
			return requestCancelledResponse
		}
		results = append(results, result)

		responseData := a.parseResponse(result)
		responseStore[fmt.Sprintf("request%d", i+1)] = responseData

		if responseBody, exists := responseData["body"].(string); exists {
			a.ParseResponseForVariables(responseBody)
		}

		if postScript, exists := req["postScript"].(string); exists && postScript != "" {
			a.executeScript(postScript, &scriptExecutionContext{
				Request:       req,
				Response:      responseData,
				Variables:     a.variables,
				ResponseStore: responseStore,
			}, "post")
			if ctx.Err() == context.Canceled {
				return requestCancelledResponse
			}
		}
	}

	return strings.Join(results, "\n\n")
}

func (a *App) resolveResponseReferences(input string, responseStore map[string]map[string]interface{}) string {
	if input == "" {
		return input
	}

	variableRegex := regexp.MustCompile(`\{\{([^}]+)\}\}`)
	return variableRegex.ReplaceAllStringFunc(input, func(match string) string {
		expr := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}"))
		if expr == "" {
			return match
		}

		parts := strings.Split(expr, ".")
		if len(parts) == 0 {
			return match
		}

		if len(parts) >= 2 && strings.HasPrefix(parts[0], "request") {
			requestKey := parts[0]
			resp, exists := responseStore[requestKey]
			if !exists {
				return match
			}

			if len(parts) >= 3 && parts[1] == "response" {
				switch parts[2] {
				case "body":
					body, _ := resp["body"].(string)
					if body == "" {
						return match
					}
					if len(parts) == 3 {
						return body
					}
					path := strings.Join(parts[3:], ".")
					var jsonData map[string]interface{}
					if err := json.Unmarshal([]byte(body), &jsonData); err == nil {
						return a.getJSONValue(jsonData, path)
					}
				case "status":
					if status, ok := resp["status"].(int); ok {
						return strconv.Itoa(status)
					}
				case "headers":
					if len(parts) >= 4 {
						if headers, ok := resp["headers"].(map[string]string); ok {
							if val, ok := headers[parts[3]]; ok {
								return val
							}
						}
					}
				}
			}

			return match
		}

		if len(parts) >= 2 {
			switch parts[0] {
			case "variables":
				key := strings.Join(parts[1:], ".")
				if val, ok := a.variables[key]; ok {
					return val
				}
			case "env":
				key := strings.Join(parts[1:], ".")
				if envVars, ok := a.environments[a.currentEnv]; ok {
					if val, ok := envVars[key]; ok {
						return val
					}
				}
			}
		}

		if val, ok := a.variables[expr]; ok {
			return val
		}

		return match // Return original if not resolved
	})
}

// getJSONValue extracts a value from JSON using dot notation
func (a *App) getJSONValue(data map[string]interface{}, path string) string {
	parts := strings.Split(path, ".")
	current := data

	for i, part := range parts {
		if i == len(parts)-1 {
			if val, exists := current[part]; exists {
				switch v := val.(type) {
				case string:
					return v
				case float64:
					return strconv.FormatFloat(v, 'f', -1, 64)
				case bool:
					return strconv.FormatBool(v)
				default:
					if jsonBytes, err := json.Marshal(v); err == nil {
						return string(jsonBytes)
					}
				}
			}
		} else {
			if next, ok := current[part].(map[string]interface{}); ok {
				current = next
			} else {
				break
			}
		}
	}
	return ""
}

// parseResponse parses the response string into structured data
func (a *App) parseResponse(response string) map[string]interface{} {
	result := make(map[string]interface{})
	lines := strings.Split(response, "\n")

	if len(lines) > 0 {
		// Parse status line
		statusLine := lines[0]
		if strings.Contains(statusLine, "Status: ") {
			statusStr := strings.TrimPrefix(statusLine, "Status: ")
			if statusCode, err := strconv.Atoi(statusStr); err == nil {
				result["status"] = statusCode
			}
		}
	}

	if len(lines) > 1 && strings.Contains(lines[1], "Body: ") {
		body := strings.TrimPrefix(lines[1], "Body: ")
		result["body"] = body
		result["headers"] = make(map[string]string) // Placeholder for headers
	}

	return result
}

type scriptExecutionContext struct {
	Request       map[string]interface{}            `json:"request"`
	Response      map[string]interface{}            `json:"response"`
	Variables     map[string]string                 `json:"variables"`
	ResponseStore map[string]map[string]interface{} `json:"responseStore"`
	Stage         string                            `json:"stage"`
}

// executeScript executes JavaScript code for chained requests
func (a *App) executeScript(rawScript string, ctx *scriptExecutionContext, stage string) {
	cleanScript := cleanScriptContent(rawScript)
	if strings.TrimSpace(cleanScript) == "" {
		return
	}
	if ctx == nil {
		ctx = &scriptExecutionContext{}
	}
	ctx.Stage = stage
	if ctx.Variables == nil {
		ctx.Variables = a.variables
	}
	vm := goja.New()
	vm.Set("context", ctx)
	source := buildScriptSource(ctx)

	vm.Set("setVar", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return goja.Undefined()
		}
		key := call.Arguments[0].String()
		strVal := call.Arguments[1].String()
		a.variables[key] = strVal
		ctx.Variables[key] = strVal
		return goja.Undefined()
	})

	vm.Set("getVar", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		key := call.Arguments[0].String()
		if val, ok := a.variables[key]; ok {
			return vm.ToValue(val)
		}
		return goja.Undefined()
	})

	vm.Set("setHeader", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return goja.Undefined()
		}
		req := a.ensureScriptRequest(ctx)
		headers := toStringMap(req["headers"])
		headers[call.Arguments[0].String()] = call.Arguments[1].String()
		req["headers"] = headers
		return goja.Undefined()
	})

	vm.Set("updateRequest", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		patch := toInterfaceMap(call.Arguments[0])
		if patch == nil {
			return goja.Undefined()
		}
		req := a.ensureScriptRequest(ctx)
		for key, val := range patch {
			if key == "headers" {
				existing := toStringMap(req["headers"])
				incoming := toStringMap(val)
				req["headers"] = mergeStringMaps(existing, incoming)
				continue
			}
			req[key] = val
		}
		return goja.Undefined()
	})

	vm.Set("assert", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		if call.Arguments[0].ToBoolean() {
			return goja.Undefined()
		}
		message := "Assertion failed"
		if len(call.Arguments) > 1 {
			message = call.Arguments[1].String()
		}
		panic(errors.New(message))
	})

	vm.Set("delay", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		if duration, ok := durationFromValue(call.Arguments[0].Export()); ok {
			time.Sleep(duration)
		}
		return goja.Undefined()
	})

	console := vm.NewObject()
	console.Set("log", func(call goja.FunctionCall) goja.Value {
		a.appendScriptLog("info", source, buildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	console.Set("info", func(call goja.FunctionCall) goja.Value {
		a.appendScriptLog("info", source, buildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	console.Set("warn", func(call goja.FunctionCall) goja.Value {
		a.appendScriptLog("warn", source, buildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	console.Set("error", func(call goja.FunctionCall) goja.Value {
		a.appendScriptLog("error", source, buildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	vm.Set("console", console)

	defer func() {
		if r := recover(); r != nil {
			a.appendScriptLog("error", source, fmt.Sprintf("panic: %v", r))
		}
	}()

	if _, err := vm.RunString(cleanScript); err != nil {
		a.appendScriptLog("error", source, fmt.Sprintf("runtime error: %v", err))
	}
}

func (a *App) ensureScriptRequest(ctx *scriptExecutionContext) map[string]interface{} {
	if ctx.Request == nil {
		ctx.Request = make(map[string]interface{})
	}
	return ctx.Request
}

func toStringMap(value interface{}) map[string]string {
	result := make(map[string]string)
	switch data := value.(type) {
	case map[string]string:
		for k, v := range data {
			result[k] = v
		}
	case map[string]interface{}:
		for k, v := range data {
			result[k] = fmt.Sprint(v)
		}
	case goja.Value:
		return toStringMap(data.Export())
	case nil:
		// no-op
	default:
		if str, ok := data.(string); ok {
			result[str] = ""
		}
	}
	return result
}

func toInterfaceMap(value goja.Value) map[string]interface{} {
	if value == nil {
		return nil
	}
	switch data := value.Export().(type) {
	case map[string]interface{}:
		return data
	default:
		return nil
	}
}

func mergeStringMaps(dst, src map[string]string) map[string]string {
	if dst == nil {
		dst = make(map[string]string, len(src))
	}
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func buildMessageFromArgs(args []goja.Value) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, valueToString(arg.Export()))
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func valueToString(val interface{}) string {
	switch v := val.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case map[string]interface{}, []interface{}:
		if data, err := json.Marshal(v); err == nil {
			return string(data)
		}
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func durationFromValue(val interface{}) (time.Duration, bool) {
	switch v := val.(type) {
	case int:
		return time.Duration(v) * time.Millisecond, true
	case int32:
		return time.Duration(v) * time.Millisecond, true
	case int64:
		return time.Duration(v) * time.Millisecond, true
	case float32:
		ms := float64(v)
		if ms < 0 {
			ms = 0
		}
		return time.Duration(ms * float64(time.Millisecond)), true
	case float64:
		ms := v
		if ms < 0 {
			ms = 0
		}
		return time.Duration(ms * float64(time.Millisecond)), true
	case string:
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			if parsed < 0 {
				parsed = 0
			}
			return time.Duration(parsed * float64(time.Millisecond)), true
		}
	case goja.Value:
		return durationFromValue(v.Export())
	case nil:
		return 0, false
	default:
		if num, ok := v.(fmt.Stringer); ok {
			if parsed, err := strconv.ParseFloat(num.String(), 64); err == nil {
				if parsed < 0 {
					parsed = 0
				}
				return time.Duration(parsed * float64(time.Millisecond)), true
			}
		}
	}
	return 0, false
}

func buildScriptSource(ctx *scriptExecutionContext) string {
	stage := ctx.Stage
	if stage == "" {
		stage = "script"
	}
	if ctx.Request != nil {
		if name, ok := ctx.Request["name"].(string); ok && name != "" {
			return fmt.Sprintf("%s:%s", stage, name)
		}
		if method, ok := ctx.Request["method"].(string); ok && method != "" {
			if url, ok := ctx.Request["url"].(string); ok && url != "" {
				return fmt.Sprintf("%s:%s %s", stage, method, url)
			}
			return fmt.Sprintf("%s:%s", stage, method)
		}
	}
	return stage
}

func (a *App) appendScriptLog(level, source, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if source == "" {
		source = "script"
	}
	entry := ScriptLogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Level:     strings.ToLower(level),
		Source:    source,
		Message:   message,
	}
	a.scriptLogMutex.Lock()
	a.scriptLogs = append(a.scriptLogs, entry)
	if len(a.scriptLogs) > maxScriptLogs {
		a.scriptLogs = a.scriptLogs[len(a.scriptLogs)-maxScriptLogs:]
	}
	a.scriptLogMutex.Unlock()
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, scriptLogEventName, entry)
	}
}

// RecordScriptLog enables the frontend to push logs into the shared console
func (a *App) RecordScriptLog(level, source, message string) {
	a.appendScriptLog(level, source, message)
}

// GetScriptLogs returns the accumulated script console entries
func (a *App) GetScriptLogs() []ScriptLogEntry {
	a.scriptLogMutex.Lock()
	defer a.scriptLogMutex.Unlock()
	logs := make([]ScriptLogEntry, len(a.scriptLogs))
	copy(logs, a.scriptLogs)
	return logs
}

// ClearScriptLogs wipes the in-memory console buffer
func (a *App) ClearScriptLogs() {
	a.scriptLogMutex.Lock()
	a.scriptLogs = nil
	a.scriptLogMutex.Unlock()
}

// executeAssertions executes assertion checks
func (a *App) executeAssertions(assertions []string, responseData map[string]interface{}) {
	for _, assertion := range assertions {
		// Parse assertion like "status == 200" or "response contains 'success'"
		if strings.Contains(assertion, "==") {
			parts := strings.SplitN(assertion, "==", 2)
			if len(parts) == 2 {
				left := strings.TrimSpace(parts[0])
				right := strings.TrimSpace(parts[1])

				if left == "status" {
					if status, ok := responseData["status"].(int); ok {
						if expected, err := strconv.Atoi(right); err == nil {
							if status != expected {
								fmt.Printf("Assertion failed: expected status %d, got %d\n", expected, status)
							}
						}
					}
				}
			}
		} else if strings.Contains(assertion, "contains") {
			parts := strings.SplitN(assertion, "contains", 2)
			if len(parts) == 2 {
				field := strings.TrimSpace(parts[0])
				value := strings.Trim(strings.TrimSpace(parts[1]), "'\"")

				if field == "response" {
					if body, ok := responseData["body"].(string); ok {
						if !strings.Contains(body, value) {
							fmt.Printf("Assertion failed: response does not contain '%s'\n", value)
						}
					}
				}
			}
		}
	}
}

// ParseResponseForVariables parses JSON response and sets variables
func (a *App) ParseResponseForVariables(responseBody string) {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(responseBody), &data); err == nil {
		a.setVariablesFromMap("", data)
	}
}

func (a *App) setVariablesFromMap(prefix string, data map[string]interface{}) {
	for key, value := range data {
		fullKey := key
		if prefix != "" {
			fullKey = prefix + "." + key
		}
		switch v := value.(type) {
		case string:
			a.variables[fullKey] = v
		case float64:
			a.variables[fullKey] = fmt.Sprintf("%.0f", v)
		case map[string]interface{}:
			a.setVariablesFromMap(fullKey, v)
		}
	}
}

// SaveData saves environments and variables to files
// func (a *App) SaveData() {
// 	// Save environments
// 	envData, _ := json.Marshal(a.environments)
// 	os.WriteFile("environments.json", envData, 0644)

// 	// Save variables
// 	varData, _ := json.Marshal(a.variables)
// 	os.WriteFile("variables.json", varData, 0644)
// }

// LoadData loads environments and variables from files
// func (a *App) LoadData() {
// 	// Load environments
// 	if data, err := os.ReadFile("environments.json"); err == nil {
// 		json.Unmarshal(data, &a.environments)
// 	}

// 	// Load variables
// 	if data, err := os.ReadFile("variables.json"); err == nil {
// 		json.Unmarshal(data, &a.variables)
// 	}
// }

// SetBasicAuth sets basic auth header
// func (a *App) SetBasicAuth(username, password string) {
// 	auth := username + ":" + password
// 	encoded := base64.StdEncoding.EncodeToString([]byte(auth))
// 	a.variables["auth"] = "Basic " + encoded
// 	// a.SaveData()
// }

// // SetBearerAuth sets bearer token
// func (a *App) SetBearerAuth(token string) {
// 	a.variables["auth"] = "Bearer " + token
// 	// a.SaveData()
// }

// SaveFileHistory writes per-file history JSON to disk
func (a *App) SaveFileHistory(fileID string, historyJson string) {
	if fileID == "" {
		return
	}
	if historyJson == "" {
		historyJson = "[]"
	}
	os.MkdirAll("history", 0755)
	filePath := filepath.Join("history", a.sanitizeFileID(fileID)+".json")
	os.WriteFile(filePath, []byte(historyJson), 0644)
}

// LoadFileHistory retrieves stored history JSON for a file
func (a *App) LoadFileHistory(fileID string) string {
	if fileID == "" {
		return "[]"
	}
	filePath := filepath.Join("history", a.sanitizeFileID(fileID)+".json")
	if data, err := os.ReadFile(filePath); err == nil {
		return string(data)
	}
	return "[]"
}

func (a *App) sanitizeFileID(fileID string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "-")
	return replacer.Replace(fileID)
}

func (a *App) registerCancel(requestID string, cancel context.CancelFunc) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	a.requestCancels[requestID] = cancel
	a.cancelMutex.Unlock()
}

func (a *App) clearCancel(requestID string) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	delete(a.requestCancels, requestID)
	a.cancelMutex.Unlock()
}

// CancelRequest cancels an in-flight request, if present.
func (a *App) CancelRequest(requestID string) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	cancel, exists := a.requestCancels[requestID]
	if exists {
		delete(a.requestCancels, requestID)
	}
	a.cancelMutex.Unlock()

	if exists {
		cancel()
	}
}

// RevealInFinder opens the file's parent directory in Finder (macOS) or Explorer (Windows)
// and selects the file. On Linux, it opens the parent directory in the default file manager.
func (a *App) RevealInFinder(filePath string) error {
	if filePath == "" {
		return errors.New("no file path provided")
	}

	// Check if the file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return errors.New("file does not exist: " + filePath)
	}

	switch goruntime.GOOS {
	case "darwin":
		// macOS: Use `open -R` to reveal in Finder
		return exec.Command("open", "-R", filePath).Start()
	case "windows":
		// Windows: Use explorer with /select flag
		return exec.Command("explorer", "/select,", filePath).Start()
	case "linux":
		// Linux: Open the parent directory with xdg-open
		parentDir := filepath.Dir(filePath)
		return exec.Command("xdg-open", parentDir).Start()
	default:
		return errors.New("unsupported operating system")
	}
}

// OpenFileDialog opens a native file dialog and returns the selected file paths
func (a *App) OpenFileDialog() ([]string, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open HTTP File",
		Filters: []runtime.FileFilter{
			{DisplayName: "HTTP Files", Pattern: "*.http"},
			{DisplayName: "All Files", Pattern: "*"},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// ReadFileContents reads a file and returns its contents
func (a *App) ReadFileContents(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// getWindowStatePath returns the path to the window state file
func (a *App) getWindowStatePath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	configDir := filepath.Join(homeDir, ".rawrequest")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(configDir, "window-state.json"), nil
}

// SaveWindowState saves the current window position and size
func (a *App) SaveWindowState() error {
	statePath, err := a.getWindowStatePath()
	if err != nil {
		return err
	}

	// Get current window position and size
	x, y := runtime.WindowGetPosition(a.ctx)
	width, height := runtime.WindowGetSize(a.ctx)
	maximized := runtime.WindowIsMaximised(a.ctx)

	state := WindowState{
		X:         x,
		Y:         y,
		Width:     width,
		Height:    height,
		Maximized: maximized,
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(statePath, data, 0644)
}

// LoadWindowState loads the saved window state
func (a *App) LoadWindowState() (*WindowState, error) {
	statePath, err := a.getWindowStatePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No saved state
		}
		return nil, err
	}

	var state WindowState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}

	return &state, nil
}

// RestoreWindowState restores the window to its saved position and size
func (a *App) RestoreWindowState() {
	state, err := a.LoadWindowState()
	if err != nil || state == nil {
		return // Use defaults if no saved state
	}

	// Validate the state - ensure window is at least partially visible
	if state.Width < 400 {
		state.Width = 1024
	}
	if state.Height < 300 {
		state.Height = 768
	}

	// Set position and size
	runtime.WindowSetPosition(a.ctx, state.X, state.Y)
	runtime.WindowSetSize(a.ctx, state.Width, state.Height)

	if state.Maximized {
		runtime.WindowMaximise(a.ctx)
	}
}
