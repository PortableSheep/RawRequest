package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var diagnosticsMu sync.Mutex

// RecordDiagnosticLog writes a formatted, timestamped log line to ~/.rawrequest/diagnostics.log.
// It performs log rotation if the file exceeds 5MB.
func (a *App) RecordDiagnosticLog(level string, message string) {
	diagnosticsMu.Lock()
	defer diagnosticsMu.Unlock()

	appDir := a.getAppDir()
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return
	}

	logPath := filepath.Join(appDir, "diagnostics.log")

	// Rotate log if it exceeds 5MB
	if info, err := os.Stat(logPath); err == nil && info.Size() > 5*1024*1024 {
		oldPath := filepath.Join(appDir, "diagnostics.old.log")
		_ = os.Remove(oldPath)
		_ = os.Rename(logPath, oldPath)
	}

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	timestamp := time.Now().Format("2006-01-02 15:04:05")
	formattedMsg := fmt.Sprintf("[%s] [%s] %s\n", timestamp, level, message)
	_, _ = f.WriteString(formattedMsg)
}

// ExportDiagnosticLogs opens a native save file dialog and copies diagnostics.log to the chosen path.
func (a *App) ExportDiagnosticLogs() (string, error) {
	logPath := filepath.Join(a.getAppDir(), "diagnostics.log")

	// Check if log file exists
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		// Log file doesn't exist, let's create a message or dummy file so they can still export something
		a.RecordDiagnosticLog("INFO", "Diagnostics log initialized for export.")
	}

	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Diagnostic Logs",
		DefaultFilename: "rawrequest-diagnostics.log",
		Filters: []runtime.FileFilter{
			{DisplayName: "Log Files (*.log)", Pattern: "*.log"},
			{DisplayName: "All Files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if savePath == "" {
		return "", errors.New("no path selected")
	}

	// Copy current log to target path
	src, err := os.Open(logPath)
	if err != nil {
		return "", err
	}
	defer src.Close()

	dst, err := os.OpenFile(savePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		return "", err
	}

	// If there's diagnostics.old.log, append it for completeness
	oldPath := filepath.Join(a.getAppDir(), "diagnostics.old.log")
	if _, errOld := os.Stat(oldPath); errOld == nil {
		_, _ = dst.WriteString("\n--- HISTORICAL LOGS (diagnostics.old.log) ---\n")
		oldSrc, errOldOpen := os.Open(oldPath)
		if errOldOpen == nil {
			defer oldSrc.Close()
			_, _ = io.Copy(dst, oldSrc)
		}
	}

	return savePath, nil
}
