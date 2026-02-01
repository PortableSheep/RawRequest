package main

import (
	"fmt"
	"io"
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

// finalizePendingUpdaterReplacement checks for and applies any pending updater replacement.
// On Windows, the updater can't replace itself while running, so it saves the new version
// as rawrequest-updater.exe.new which we move into place on next app startup.
func (a *App) finalizePendingUpdaterReplacement() {
	if runtime.GOOS != "windows" {
		return
	}

	exePath, err := os.Executable()
	if err != nil {
		return
	}
	exeDir := filepath.Dir(exePath)

	pendingUpdater := filepath.Join(exeDir, "rawrequest-updater.exe.new")
	targetUpdater := filepath.Join(exeDir, "rawrequest-updater.exe")

	if _, err := os.Stat(pendingUpdater); os.IsNotExist(err) {
		return
	}

	fmt.Println("Finalizing updater replacement...")

	// Try to replace the updater
	// First, try to remove the old one
	if err := os.Remove(targetUpdater); err != nil && !os.IsNotExist(err) {
		// If we can't remove it, try renaming it out of the way
		backupUpdater := filepath.Join(exeDir, "rawrequest-updater.exe.old")
		_ = os.Remove(backupUpdater)
		if err := os.Rename(targetUpdater, backupUpdater); err != nil {
			fmt.Printf("Warning: could not move old updater: %v\n", err)
			return
		}
	}

	// Move the new updater into place
	if err := os.Rename(pendingUpdater, targetUpdater); err != nil {
		// Rename might fail across volumes, try copy instead
		if err := copyFile(pendingUpdater, targetUpdater); err != nil {
			fmt.Printf("Warning: could not install new updater: %v\n", err)
			return
		}
		_ = os.Remove(pendingUpdater)
	}

	fmt.Println("Updater replacement complete")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
