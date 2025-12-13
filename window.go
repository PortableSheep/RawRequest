// Window management functionality for RawRequest.
// This file contains window state persistence, file dialogs, and file operations.

package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// RevealInFinder opens the file's parent directory in Finder (macOS) or Explorer (Windows)
// and selects the file. On Linux, it opens the parent directory in the default file manager.
func (a *App) RevealInFinder(filePath string) error {
	if filePath == "" {
		return errors.New("no file path provided")
	}

	// Check if the file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return errors.New("file does not exist: " + filePath)
	}

	switch goruntime.GOOS {
	case "darwin":
		// macOS: Use `open -R` to reveal in Finder
		return exec.Command("open", "-R", filePath).Start()
	case "windows":
		// Windows: Use explorer with /select flag
		return exec.Command("explorer", "/select,", filePath).Start()
	case "linux":
		// Linux: Open the parent directory with xdg-open
		parentDir := filepath.Dir(filePath)
		return exec.Command("xdg-open", parentDir).Start()
	default:
		return errors.New("unsupported operating system")
	}
}

// OpenFileDialog opens a native file dialog and returns the selected file paths
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

// ReadFileContents reads a file and returns its contents
func (a *App) ReadFileContents(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// getWindowStatePath returns the path to the window state file
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

// SaveWindowState saves the current window position and size
func (a *App) SaveWindowState() error {
	statePath, err := a.getWindowStatePath()
	if err != nil {
		return err
	}

	// Get current window position and size
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

// LoadWindowState loads the saved window state
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

// RestoreWindowState restores the window to its saved position and size
func (a *App) RestoreWindowState() {
	state, err := a.LoadWindowState()
	if err != nil || state == nil {
		return // Use defaults if no saved state
	}

	// Validate the state - ensure window is at least partially visible
	if state.Width < 400 {
		state.Width = 1024
	}
	if state.Height < 300 {
		state.Height = 768
	}

	// Set position and size
	runtime.WindowSetPosition(a.ctx, state.X, state.Y)
	runtime.WindowSetSize(a.ctx, state.Width, state.Height)

	if state.Maximized {
		runtime.WindowMaximise(a.ctx)
	}
}
