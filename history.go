package main

import (
	"os"
	"path/filepath"
	"strings"
)

func (a *App) SaveFileHistory(fileID string, historyJson string) {
	if fileID == "" {
		return
	}
	if historyJson == "" {
		historyJson = "[]"
	}
	// Use app-specific directory so history persists across runs and working dirs
	appDir := a.getAppDir()
	historyDir := filepath.Join(appDir, "history")
	if err := os.MkdirAll(historyDir, 0755); err != nil {
		// Fallback to local history dir if app dir creation fails
		_ = os.MkdirAll("history", 0755)
		historyDir = "history"
	}
	filePath := filepath.Join(historyDir, a.sanitizeFileID(fileID)+".json")
	_ = os.WriteFile(filePath, []byte(historyJson), 0644)
}

func (a *App) LoadFileHistory(fileID string) string {
	if fileID == "" {
		return "[]"
	}
	appDir := a.getAppDir()
	historyDir := filepath.Join(appDir, "history")
	filePath := filepath.Join(historyDir, a.sanitizeFileID(fileID)+".json")
	if data, err := os.ReadFile(filePath); err == nil {
		return string(data)
	}
	// Fallback to local history dir
	filePath = filepath.Join("history", a.sanitizeFileID(fileID)+".json")
	if data, err := os.ReadFile(filePath); err == nil {
		return string(data)
	}
	return "[]"
}

// LoadFileHistoryFromDir retrieves stored history JSON for a file from a specific directory.
// dir should be the base directory where a "history" subfolder exists.
func (a *App) LoadFileHistoryFromDir(fileID string, dir string) string {
	if fileID == "" {
		return "[]"
	}
	if dir == "" {
		return "[]"
	}
	historyDir := filepath.Join(dir, "history")
	filePath := filepath.Join(historyDir, a.sanitizeFileID(fileID)+".json")
	if data, err := os.ReadFile(filePath); err == nil {
		return string(data)
	}
	return "[]"
}

// LoadFileHistoryFromRunLocation retrieves stored history JSON for a file from the current
// working directory's "history" folder.
func (a *App) LoadFileHistoryFromRunLocation(fileID string) string {
	wd, err := os.Getwd()
	if err != nil {
		return "[]"
	}
	return a.LoadFileHistoryFromDir(fileID, wd)
}

func (a *App) sanitizeFileID(fileID string) string {
	// Keep history filenames safe + stable across OS/filesystems.
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "-")
	return replacer.Replace(fileID)
}

func (a *App) SaveFileHistoryToDir(fileID string, historyJson string, dir string) {
	if fileID == "" {
		return
	}
	if historyJson == "" {
		historyJson = "[]"
	}
	if dir == "" {
		return
	}
	historyDir := filepath.Join(dir, "history")
	if err := os.MkdirAll(historyDir, 0755); err != nil {
		// If we can't create the requested dir, don't fallback to app dir silently
		return
	}
	filePath := filepath.Join(historyDir, a.sanitizeFileID(fileID)+".json")
	_ = os.WriteFile(filePath, []byte(historyJson), 0644)
}

func (a *App) SaveFileHistoryToRunLocation(fileID string, historyJson string) {
	wd, err := os.Getwd()
	if err != nil {
		return
	}
	a.SaveFileHistoryToDir(fileID, historyJson, wd)
}
