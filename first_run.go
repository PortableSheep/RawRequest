package main

import (
	"os"
	"path/filepath"
	"runtime"
)

func (a *App) IsFirstRun() bool {
	appDir := a.getAppDir()
	flagFile := filepath.Join(appDir, ".first-run-completed")
	_, err := os.Stat(flagFile)
	return os.IsNotExist(err)
}

func (a *App) MarkFirstRunComplete() error {
	appDir := a.getAppDir()
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return err
	}

	flagFile := filepath.Join(appDir, ".first-run-completed")
	return os.WriteFile(flagFile, []byte("completed"), 0o644)
}

func (a *App) getAppDir() string {
	homeDir, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(homeDir, ".rawrequest")
	case "windows":
		return filepath.Join(homeDir, "AppData", "Roaming", "RawRequest")
	default:
		return filepath.Join(homeDir, ".rawrequest")
	}
}
