package main

import (
	"strings"
	"time"

	rb "rawrequest/internal/ringbuffer"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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
	if a.scriptLogs == nil {
		a.scriptLogs = rb.New[ScriptLogEntry](maxScriptLogs)
	}
	a.scriptLogs.Append(entry)
	a.scriptLogMutex.Unlock()
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, scriptLogEventName, entry)
	}
}

func (a *App) RecordScriptLog(level, source, message string) {
	a.appendScriptLog(level, source, message)
}

func (a *App) GetScriptLogs() []ScriptLogEntry {
	a.scriptLogMutex.Lock()
	defer a.scriptLogMutex.Unlock()
	if a.scriptLogs == nil {
		return nil
	}
	return a.scriptLogs.Items()
}

func (a *App) ClearScriptLogs() {
	a.scriptLogMutex.Lock()
	if a.scriptLogs != nil {
		a.scriptLogs.Clear()
	}
	a.scriptLogMutex.Unlock()
}
