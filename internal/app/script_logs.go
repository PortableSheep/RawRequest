package app

// appendScriptLog, RecordScriptLog, GetScriptLogs, and ClearScriptLogs are
// the internal/Wails-bound façade for script log recording. They delegate
// storage and buffering to the concurrency-safe
// internal/scriptlogstore.Store owned by App (a.scriptLogs); that package
// has no dependency on Wails, so publishing the resulting entry as an event
// remains App's responsibility here.

func (a *App) appendScriptLog(level, source, message string) {
	entry, ok := a.scriptLogs.Append(level, source, message)
	if !ok {
		return
	}
	a.emitEvent(scriptLogEventName, entry)
}

func (a *App) RecordScriptLog(level, source, message string) {
	a.appendScriptLog(level, source, message)
}

func (a *App) GetScriptLogs() []ScriptLogEntry {
	return a.scriptLogs.Items()
}

func (a *App) ClearScriptLogs() {
	a.scriptLogs.Clear()
}
