// Script console logging for RawRequest.
// This file contains the console log buffer and event emission for script output.

package main

import (
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// appendScriptLog adds a log entry to the console buffer and emits it to the frontend.
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
