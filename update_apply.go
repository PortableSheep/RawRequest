package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) StartUpdateAndRestart(latestVersion string) error {
	latestVersion = strings.TrimSpace(latestVersion)
	if latestVersion == "" {
		return errors.New("missing latest version")
	}

	wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Starting update…"})

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

	wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Downloading update…"})

	artifactPath, shaHex, err := downloadUpdateArtifact(artifactURL, func(written, total int64) {
		payload := map[string]any{"written": written}
		if total > 0 {
			payload["total"] = total
			payload["percent"] = float64(written) / float64(total)
		}
		wailsruntime.EventsEmit(a.ctx, "update:progress", payload)
	})
	if err != nil {
		wailsruntime.EventsEmit(a.ctx, "update:error", map[string]any{"message": err.Error()})
		return err
	}

	wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Applying update…"})

	cmd := exec.Command(updaterPath,
		"--pid", strconv.Itoa(os.Getpid()),
		"--install-path", installPath,
		"--artifact-path", artifactPath,
		"--sha256", shaHex,
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

func downloadUpdateArtifact(url string, onProgress func(written, total int64)) (path string, sha256Hex string, err error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", "RawRequest-Updater")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("download failed with HTTP %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "rawrequest-update-artifact-*")
	if err != nil {
		return "", "", err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(tmp.Name())
		}
	}()
	defer tmp.Close()

	total := resp.ContentLength
	h := sha256.New()

	buf := make([]byte, 256*1024)
	var written int64
	lastEmit := time.Now().Add(-1 * time.Second)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				err = werr
				return "", "", err
			}
			_, _ = h.Write(buf[:n])
			written += int64(n)
			if onProgress != nil && (time.Since(lastEmit) > 150*time.Millisecond || (total > 0 && written == total)) {
				lastEmit = time.Now()
				onProgress(written, total)
			}
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) {
				break
			}
			err = rerr
			return "", "", err
		}
	}

	sha256Hex = hex.EncodeToString(h.Sum(nil))
	return tmp.Name(), sha256Hex, nil
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
