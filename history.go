// File history persistence for RawRequest.
// This file contains functions for saving and loading per-file history.

package main

import (
	"os"
	"path/filepath"
	"strings"
)

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

// sanitizeFileID converts a file ID to a safe filename
func (a *App) sanitizeFileID(fileID string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "-")
	return replacer.Replace(fileID)
}
