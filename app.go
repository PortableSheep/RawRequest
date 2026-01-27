//go:generate go run ./scripts/generate_script_cleaner.go

package main

import (
	"context"
	"fmt"
	"strings"
	"sync"

	rc "rawrequest/internal/requestchain"
	rp "rawrequest/internal/responseparse"
	rb "rawrequest/internal/ringbuffer"
	se "rawrequest/internal/scriptexec"
	sr "rawrequest/internal/scriptruntime"
	tpl "rawrequest/internal/templating"
	vj "rawrequest/internal/varsjson"
)

type TimingBreakdown struct {
	DNSLookup       int64 `json:"dnsLookup"`
	TCPConnect      int64 `json:"tcpConnect"`
	TLSHandshake    int64 `json:"tlsHandshake"`
	TimeToFirstByte int64 `json:"timeToFirstByte"`
	ContentTransfer int64 `json:"contentTransfer"`
	Total           int64 `json:"total"`
}

type ResponseMetadata struct {
	Timing  TimingBreakdown   `json:"timing"`
	Size    int64             `json:"size"`
	Headers map[string]string `json:"headers"`
}

type WindowState struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

type App struct {
	ctx             context.Context
	variables       map[string]string
	variablesMu     sync.RWMutex
	environments    map[string]map[string]string
	currentEnv      string
	envMu           sync.RWMutex
	requestCancels  map[string]context.CancelFunc
	cancelMutex     sync.Mutex
	scriptLogs      *rb.Buffer[ScriptLogEntry]
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

func NewApp() *App {
	return &App{
		variables:      make(map[string]string),
		environments:   make(map[string]map[string]string),
		currentEnv:     "default",
		requestCancels: make(map[string]context.CancelFunc),
		scriptLogs:     rb.New[ScriptLogEntry](maxScriptLogs),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) onDomReady(ctx context.Context) {
	a.RestoreWindowState()

	if a.IsFirstRun() {
		fmt.Println("First run detected")
	}
}

func (a *App) onBeforeClose(ctx context.Context) bool {
	_ = a.SaveWindowState()
	return false
}

func (a *App) ExecuteRequests(requests []map[string]interface{}) string {
	return a.executeRequestsWithContext(context.Background(), requests)
}

func (a *App) ExecuteRequestsWithID(requestID string, requests []map[string]interface{}) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.executeRequestsWithContext(ctx, requests)
}

func (a *App) executeRequestsWithContext(ctx context.Context, requests []map[string]interface{}) string {
	return rc.Execute(ctx, requests, rc.Dependencies{
		CancelledResponse: requestCancelledResponse,
		VariablesSnapshot: a.variablesSnapshot,
		Resolve:           a.resolveResponseReferences,
		PerformRequest:    a.performRequest,
		ParseResponse:     a.parseResponse,
		ApplyVarsFromBody: a.ParseResponseForVariables,
		ExecuteScript:     a.executeScript,
	})
}

func (a *App) resolveResponseReferences(input string, responseStore map[string]map[string]interface{}) string {
	return tpl.Resolve(input, a.variablesSnapshot(), a.currentEnvVarsSnapshot(), responseStore)
}

func (a *App) parseResponse(response string) map[string]interface{} {
	return rp.Parse(response)
}

func (a *App) executeScript(rawScript string, ctx *sr.ExecutionContext, stage string) {
	cleanScript := cleanScriptContent(rawScript)

	if strings.TrimSpace(cleanScript) == "" {
		return
	}

	se.Execute(cleanScript, ctx, stage, se.Dependencies{
		VariablesSnapshot: a.variablesSnapshot,
		GetVar:            a.getVariable,
		SetVar:            a.SetVariable,
		AppendLog:         a.appendScriptLog,
	})
}

func (a *App) ParseResponseForVariables(responseBody string) {
	a.variablesMu.Lock()
	defer a.variablesMu.Unlock()
	vj.ApplyFromJSON(a.variables, responseBody)
}

func (a *App) getVariable(key string) (string, bool) {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	val, ok := a.variables[key]
	return val, ok
}

func (a *App) variablesSnapshot() map[string]string {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	out := make(map[string]string, len(a.variables))
	for k, v := range a.variables {
		out[k] = v
	}
	return out
}

func (a *App) currentEnvVarsSnapshot() map[string]string {
	a.envMu.RLock()
	defer a.envMu.RUnlock()
	if a.environments == nil {
		return nil
	}
	vars := a.environments[a.currentEnv]
	if vars == nil {
		return nil
	}
	out := make(map[string]string, len(vars))
	for k, v := range vars {
		out[k] = v
	}
	return out
}
