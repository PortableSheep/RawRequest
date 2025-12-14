//go:generate go run ./scripts/generate_script_cleaner.go

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
	"github.com/gen2brain/beeep"
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

	// Check if this is the first run - the frontend will handle opening examples
	if a.IsFirstRun() {
		fmt.Println("First run detected")
	}
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

// SendNotification sends an OS-level notification
func (a *App) SendNotification(title, message string) error {
	return beeep.Notify(title, message, "")
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
		requests = append(requests, currentRequest)
	}

	return requests
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

// parseResponse parses the response string into structured data for scripts
// Response format: "Status: 200 OK\nHeaders: {...json...}\nBody: ..."
func (a *App) parseResponse(response string) map[string]interface{} {
	result := make(map[string]interface{})
	lines := strings.Split(response, "\n")

	for i := 0; i < len(lines); i++ {
		line := lines[i]

		// Parse status line: "Status: 200 OK"
		if strings.HasPrefix(line, "Status: ") {
			statusLine := strings.TrimPrefix(line, "Status: ")
			parts := strings.SplitN(statusLine, " ", 2)
			if len(parts) > 0 {
				if statusCode, err := strconv.Atoi(parts[0]); err == nil {
					result["status"] = statusCode
				}
				if len(parts) > 1 {
					result["statusText"] = parts[1]
				}
			}
			continue
		}

		// Parse headers: "Headers: {...ResponseMetadata JSON...}"
		if strings.HasPrefix(line, "Headers: ") {
			metadataStr := strings.TrimPrefix(line, "Headers: ")
			var metadata struct {
				Headers map[string]string `json:"headers"`
				Timing  struct {
					Total int64 `json:"total"`
				} `json:"timing"`
				Size int64 `json:"size"`
			}
			if err := json.Unmarshal([]byte(metadataStr), &metadata); err == nil {
				if metadata.Headers != nil {
					result["headers"] = metadata.Headers
				} else {
					result["headers"] = make(map[string]string)
				}
				result["responseTime"] = metadata.Timing.Total
				result["size"] = metadata.Size
			} else {
				result["headers"] = make(map[string]string)
			}
			continue
		}

		// Parse body: "Body: ..." (may span multiple lines)
		if strings.HasPrefix(line, "Body: ") {
			body := strings.TrimPrefix(line, "Body: ")
			// If there are more lines, append them (multiline body)
			if i+1 < len(lines) {
				body += "\n" + strings.Join(lines[i+1:], "\n")
			}
			result["body"] = body
			result["text"] = body // Alias for consistency with frontend

			// Try to parse JSON body
			var jsonData interface{}
			if err := json.Unmarshal([]byte(body), &jsonData); err == nil {
				result["json"] = jsonData
			}
			break
		}
	}

	// Ensure headers exists even if not parsed
	if _, exists := result["headers"]; !exists {
		result["headers"] = make(map[string]string)
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

// ParseResponseForVariables parses JSON response and sets variables
func (a *App) ParseResponseForVariables(responseBody string) {
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(responseBody), &data); err == nil {
		a.setVariablesFromMap("", data)
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

// IsFirstRun checks if this is the first time the app has been run
func (a *App) IsFirstRun() bool {
	appDir := a.getAppDir()
	flagFile := filepath.Join(appDir, ".first-run-completed")
	_, err := os.Stat(flagFile)
	return os.IsNotExist(err)
}

// MarkFirstRunComplete marks the first run as completed
func (a *App) MarkFirstRunComplete() error {
	appDir := a.getAppDir()
	fmt.Printf("MarkFirstRunComplete: Creating directory %s\n", appDir)
	if err := os.MkdirAll(appDir, 0755); err != nil {
		fmt.Printf("MarkFirstRunComplete: Error creating directory: %v\n", err)
		return err
	}
	flagFile := filepath.Join(appDir, ".first-run-completed")
	fmt.Printf("MarkFirstRunComplete: Writing flag file %s\n", flagFile)
	err := os.WriteFile(flagFile, []byte("completed"), 0644)
	if err != nil {
		fmt.Printf("MarkFirstRunComplete: Error writing file: %v\n", err)
	}
	return err
}

// GetExamplesForFirstRun returns examples content if this is first run
func (a *App) GetExamplesForFirstRun() (string, string, bool) {
	fmt.Println("GetExamplesForFirstRun: Checking if first run")
	if !a.IsFirstRun() {
		fmt.Println("GetExamplesForFirstRun: Not first run")
		return "", "", false
	}

	fmt.Println("GetExamplesForFirstRun: Is first run, reading embedded file")
	// Read the embedded examples file
	content, err := examplesFS.ReadFile("examples/examples.http")
	if err != nil {
		fmt.Printf("GetExamplesForFirstRun: Error reading embedded file: %v\n", err)
		return "", "", false
	}

	fmt.Printf("GetExamplesForFirstRun: Successfully read %d bytes\n", len(content))

	return string(content), "examples.http", true
}

// getAppDir returns the application data directory
func (a *App) getAppDir() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, "Library", "Application Support", "RawRequest")
}

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
