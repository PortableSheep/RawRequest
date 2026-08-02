//go:generate go run ../../scripts/generate_script_cleaner.go

package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"sync"

	cr "rawrequest/internal/cancelregistry"
	"rawrequest/internal/importers"
	rc "rawrequest/internal/requestchain"
	rp "rawrequest/internal/responseparse"
	se "rawrequest/internal/scriptexec"
	sls "rawrequest/internal/scriptlogstore"
	sr "rawrequest/internal/scriptruntime"
	tpl "rawrequest/internal/templating"
	vs "rawrequest/internal/variablestore"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
	Timing      TimingBreakdown   `json:"timing"`
	Size        int64             `json:"size"`
	Headers     map[string]string `json:"headers"`
	IsBinary    bool              `json:"isBinary,omitempty"`
	ContentType string            `json:"contentType,omitempty"`
}

type WindowState struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

type App struct {
	ctx               context.Context
	vars              *vs.Store
	cancels           *cr.Registry
	scriptLogs        *sls.Store
	eventBroker       *appEventBroker
	secretVault       *SecretVault
	secretVaultOnce   sync.Once
	secretVaultErr    error
	managedServicePID int
	managedServiceMu  sync.Mutex
	examplesFS        fs.FS
	binaryBodies      map[string][]byte
	binaryBodiesMu    sync.Mutex
	windowStateMu     sync.Mutex
	cachedWindowState WindowState
	watchedFiles      map[string]watchedFileState
	watchedFilesMu    sync.Mutex
	shutdownOnce      sync.Once
	shutdownErr       error
	stopMockServerFn  func() error
	stopManagedSvcFn  func() error
	saveWindowStateFn func() error
}

const (
	requestCancelledResponse = "__CANCELLED__"
	scriptLogEventName       = "script-log"
	maxScriptLogs            = 500
)

// ScriptLogEntry is the Wails-bound representation of a single script log
// line. It is a type alias for internal/scriptlogstore.Entry, which owns
// the actual storage/buffering logic, so JSON marshaling and existing
// callers (frontend bindings, service_server.go) are unaffected by the
// extraction.
type ScriptLogEntry = sls.Entry

func NewApp(examplesFS ...fs.FS) *App {
	a := &App{
		vars:         vs.New(),
		cancels:      cr.New(),
		scriptLogs:   sls.New(maxScriptLogs),
		eventBroker:  newAppEventBroker(),
		binaryBodies: make(map[string][]byte),
		watchedFiles: make(map[string]watchedFileState),
	}
	if len(examplesFS) > 0 {
		a.examplesFS = examplesFS[0]
	}
	a.stopMockServerFn = a.StopMockServer
	a.stopManagedSvcFn = a.stopManagedService
	a.saveWindowStateFn = a.SaveWindowState
	return a
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	// Best-effort install-state migrations. Runs in a goroutine so a slow
	// or hung migration cannot delay Wails initialization.
	go a.runStartupMigrations(ctx)
}

func (a *App) OnDomReady(ctx context.Context) {
	a.RestoreWindowState()

	if a.IsFirstRun() {
		fmt.Println("First run detected")
	}

	go a.trackWindowState(ctx)
	go a.startFileWatcher(ctx)

	// Show window once assets are loaded to prevent blank startup flashes
	runtime.WindowShow(ctx)
}

func (a *App) OnBeforeClose(_ context.Context) bool {
	_ = a.shutdown()
	return false
}

func (a *App) Shutdown(_ context.Context) {
	_ = a.shutdown()
}

func (a *App) shutdown() error {
	a.shutdownOnce.Do(func() {
		a.shutdownErr = errors.Join(
			runCleanupStep(a.stopMockServerFn),
			runCleanupStep(a.stopManagedSvcFn),
			runCleanupStep(a.saveWindowStateFn),
		)
	})
	return a.shutdownErr
}

func runCleanupStep(fn func() error) error {
	if fn == nil {
		return nil
	}
	return fn()
}

func (a *App) executeRequests(requests []map[string]any) string {
	return a.executeRequestsWithContext(context.Background(), requests)
}

func (a *App) executeRequestsWithID(requestID string, requests []map[string]interface{}) string {
	ctx, release := a.cancels.Track(context.Background(), requestID)
	defer release()
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
	a.vars.ApplyFromResponseJSON(responseBody)
}

func (a *App) getVariable(key string) (string, bool) {
	return a.vars.GetVariableOK(key)
}

func (a *App) variablesSnapshot() map[string]string {
	return a.vars.Variables()
}

// ImportCollection imports a Postman or Bruno collection from the given path
// and returns the generated .http file contents.
func (a *App) ImportCollection(path string) (importers.ImportResult, error) {
	result, err := importers.ImportFromPath(path)
	if err != nil {
		return importers.ImportResult{}, err
	}
	return *result, nil
}

func (a *App) currentEnvVarsSnapshot() map[string]string {
	return a.vars.CurrentEnvVariables()
}
