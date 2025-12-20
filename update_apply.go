package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) StartUpdateAndRestart(latestVersion string) error {
	latestVersion = strings.TrimSpace(latestVersion)
	if latestVersion == "" {
		return errors.New("missing latest version")
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %w", err)
	}
	exePath = filepath.Clean(exePath)

	installPath, err := determineInstallPath(exePath)
	if err != nil {
		return err
	}

	updaterPath, err := determineUpdaterPath(exePath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(updaterPath); err != nil {
		return fmt.Errorf("updater helper not found at %s: %w", updaterPath, err)
	}

	artifactURL, err := buildArtifactURL(latestVersion)
	if err != nil {
		return err
	}

	cmd := exec.Command(updaterPath,
		"--pid", strconv.Itoa(os.Getpid()),
		"--install-path", installPath,
		"--artifact-url", artifactURL,
		"--relaunch=true",
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to launch updater: %w", err)
	}

	// Quit the app so the updater can swap files on disk.
	wailsruntime.Quit(a.ctx)
	return nil
}

func determineInstallPath(exePath string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		// Expect: /path/RawRequest.app/Contents/MacOS/RawRequest
		exeDir := filepath.Dir(exePath)
		contentsDir := filepath.Dir(exeDir)
		appPath := filepath.Dir(contentsDir)
		if !strings.HasSuffix(strings.ToLower(appPath), ".app") {
			return "", fmt.Errorf("could not determine app bundle path from %s", exePath)
		}
		return appPath, nil
	case "windows":
		// Treat install path as directory containing RawRequest.exe
		return filepath.Dir(exePath), nil
	default:
		return "", fmt.Errorf("auto-update not supported on %s", runtime.GOOS)
	}
}

func determineUpdaterPath(exePath string) (string, error) {
	exeDir := filepath.Dir(exePath)
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(exeDir, "rawrequest-updater"), nil
	case "windows":
		return filepath.Join(exeDir, "rawrequest-updater.exe"), nil
	default:
		return "", fmt.Errorf("auto-update not supported on %s", runtime.GOOS)
	}
}

func buildArtifactURL(latestVersion string) (string, error) {
	v := strings.TrimPrefix(latestVersion, "v")
	tag := "v" + v

	var asset string
	switch runtime.GOOS {
	case "darwin":
		asset = fmt.Sprintf("RawRequest-%s-macos-universal.tar.gz", tag)
	case "windows":
		asset = fmt.Sprintf("RawRequest-%s-windows-portable.zip", v)
	default:
		return "", fmt.Errorf("auto-update not supported on %s", runtime.GOOS)
	}

	return fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/%s", githubOwner, githubRepo, tag, asset), nil
}
