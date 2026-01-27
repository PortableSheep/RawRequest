package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) MigrateResponsesFromRunLocationToHttpFile(fileID string, httpFilePath string) (string, error) {
	if fileID == "" {
		return "", errors.New("no file id provided")
	}
	if httpFilePath == "" {
		return "", errors.New("no http file path provided")
	}

	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	safe := a.sanitizeFileID(fileID)
	srcDir := filepath.Join(wd, safe+".responses")
	if _, err := os.Stat(srcDir); err != nil {
		// Nothing to migrate.
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	dir := filepath.Dir(httpFilePath)
	base := filepath.Base(httpFilePath)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	destDir := filepath.Join(dir, name+".responses")
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", err
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return "", err
	}

	uniqueDestPath := func(fileName string) string {
		candidate := filepath.Join(destDir, fileName)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
		ext := filepath.Ext(fileName)
		baseName := strings.TrimSuffix(fileName, ext)
		for i := 2; i < 10000; i++ {
			p := filepath.Join(destDir, fmt.Sprintf("%s-%d%s", baseName, i, ext))
			if _, err := os.Stat(p); os.IsNotExist(err) {
				return p
			}
		}
		// Fallback: timestamp-based.
		return filepath.Join(destDir, fmt.Sprintf("%s-%d%s", baseName, time.Now().UnixNano(), ext))
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		srcPath := filepath.Join(srcDir, entry.Name())
		destPath := uniqueDestPath(entry.Name())

		if err := os.Rename(srcPath, destPath); err == nil {
			continue
		}

		// Cross-device move or rename failure; fall back to copy + delete.
		data, err := os.ReadFile(srcPath)
		if err != nil {
			continue
		}
		if err := os.WriteFile(destPath, data, 0644); err != nil {
			continue
		}
		_ = os.Remove(srcPath)
	}

	// Best-effort cleanup of now-empty source dir.
	_ = os.Remove(srcDir)
	_ = os.RemoveAll(srcDir)

	return destDir, nil
}

func (a *App) RevealInFinder(filePath string) error {
	if filePath == "" {
		return errors.New("no file path provided")
	}

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return errors.New("file does not exist: " + filePath)
	}

	switch goruntime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", filePath).Start()
	case "windows":
		return exec.Command("explorer", "/select,", filePath).Start()
	case "linux":
		parentDir := filepath.Dir(filePath)
		return exec.Command("xdg-open", parentDir).Start()
	default:
		return errors.New("unsupported operating system")
	}
}

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

func (a *App) ReadFileContents(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

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

func (a *App) SaveWindowState() error {
	statePath, err := a.getWindowStatePath()
	if err != nil {
		return err
	}

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
func (a *App) RestoreWindowState() {
	state, err := a.LoadWindowState()
	if err != nil || state == nil {
		return
	}

	if state.Width < 400 {
		state.Width = 1024
	}
	if state.Height < 300 {
		state.Height = 768
	}

	if goruntime.GOOS != "darwin" {
		runtime.WindowSetPosition(a.ctx, state.X, state.Y)
	}
	runtime.WindowSetSize(a.ctx, state.Width, state.Height)

	if state.Maximized {
		runtime.WindowMaximise(a.ctx)
	}
}

func (a *App) SaveFileContents(filePath string, content string) (string, error) {
	if filePath == "" {
		return "", errors.New("no file path provided")
	}
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return "", err
	}
	return filePath, nil
}

func (a *App) SaveResponseFile(httpFilePath string, responseJson string) (string, error) {
	if httpFilePath == "" {
		return "", errors.New("no http file path provided")
	}
	dir := filepath.Dir(httpFilePath)
	base := filepath.Base(httpFilePath)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	// Save to {httpFileName}.responses/ subfolder
	responsesDir := filepath.Join(dir, name+".responses")
	if err := os.MkdirAll(responsesDir, 0755); err != nil {
		return "", err
	}
	timestamp := time.Now().Format("20060102-150405")
	outName := fmt.Sprintf("response-%s.json", timestamp)
	outPath := filepath.Join(responsesDir, outName)
	if err := os.WriteFile(outPath, []byte(responseJson), 0644); err != nil {
		return "", err
	}
	return outPath, nil
}

func (a *App) SaveResponseFileToRunLocation(fileID string, responseJson string) (string, error) {
	if fileID == "" {
		return "", errors.New("no file id provided")
	}
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	safe := a.sanitizeFileID(fileID)
	// Save to {fileId}.responses/ in working directory (same pattern as saved files)
	responsesDir := filepath.Join(wd, safe+".responses")
	if err := os.MkdirAll(responsesDir, 0755); err != nil {
		return "", err
	}
	timestamp := time.Now().Format("20060102-150405")
	outName := fmt.Sprintf("response-%s.json", timestamp)
	outPath := filepath.Join(responsesDir, outName)
	if err := os.WriteFile(outPath, []byte(responseJson), 0644); err != nil {
		return "", err
	}
	return outPath, nil
}

func (a *App) ShowSaveDialog(defaultName string) (string, error) {
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save HTTP File",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "HTTP Files", Pattern: "*.http"},
			{DisplayName: "All Files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if p == "" {
		return "", errors.New("no path selected")
	}
	return p, nil
}
