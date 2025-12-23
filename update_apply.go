package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

type preparedUpdateState struct {
	Version    string `json:"version"`
	Artifact   string `json:"artifact"`
	Sha256     string `json:"sha256"`
	UpdatedAt  string `json:"updatedAt"`
	Downloaded bool   `json:"downloaded"`
}

func (a *App) preparedUpdateStatePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || configDir == "" {
		configDir = os.TempDir()
	}
	return filepath.Join(configDir, "rawrequest", "update", "prepared_update.json")
}

func (a *App) loadPreparedUpdateState() (*preparedUpdateState, error) {
	path := a.preparedUpdateStatePath()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var st preparedUpdateState
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, err
	}
	if strings.TrimSpace(st.Version) == "" || strings.TrimSpace(st.Artifact) == "" || strings.TrimSpace(st.Sha256) == "" {
		return nil, nil
	}
	if _, err := os.Stat(st.Artifact); err != nil {
		return nil, nil
	}
	return &st, nil
}

func (a *App) savePreparedUpdateState(st preparedUpdateState) error {
	path := a.preparedUpdateStatePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (a *App) clearPreparedUpdateState() {
	path := a.preparedUpdateStatePath()
	data, err := os.ReadFile(path)
	if err == nil {
		var st preparedUpdateState
		if json.Unmarshal(data, &st) == nil {
			if strings.TrimSpace(st.Artifact) != "" {
				_ = os.Remove(st.Artifact)
			}
		}
	}
	_ = os.Remove(path)
}

func (a *App) StartUpdateAndRestart(latestVersion string) error {
	latestVersion = strings.TrimSpace(latestVersion)
	if latestVersion == "" {
		return errors.New("missing latest version")
	}

	// If we already have a prepared update for this version, apply it now.
	if st, err := a.loadPreparedUpdateState(); err == nil && st != nil && st.Version == latestVersion {
		wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Applying update…"})

		exePath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("failed to resolve executable path: %w", err)
		}
		exePath = filepath.Clean(exePath)

		installPath, err := determineInstallPath(exePath)
		if err != nil {
			return err
		}
		if err := ensureInstallParentDirWritable(installPath); err != nil {
			msg := fmt.Sprintf("Install location not writable: %v", err)
			wailsruntime.EventsEmit(a.ctx, "update:error", map[string]any{"message": msg})
			return errors.New(msg)
		}

		updaterPath, err := determineUpdaterPath(exePath)
		if err != nil {
			return err
		}
		if _, err := os.Stat(updaterPath); err != nil {
			return fmt.Errorf("updater helper not found at %s: %w", updaterPath, err)
		}

		cmd := exec.Command(updaterPath,
			"--pid", strconv.Itoa(os.Getpid()),
			"--install-path", installPath,
			"--artifact-path", st.Artifact,
			"--sha256", st.Sha256,
			"--relaunch=true",
		)
		// App stdout/stderr are often not visible in GUI builds; capture helper logs.
		logPath := filepath.Join(filepath.Dir(a.preparedUpdateStatePath()), "updater.log")
		if f, ferr := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); ferr == nil {
			cmd.Stdout = f
			cmd.Stderr = f
			// Best-effort close after start.
			defer f.Close()
		} else {
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
		}

		if err := cmd.Start(); err != nil {
			return fmt.Errorf("failed to launch updater: %w", err)
		}

		// Clear state before quitting; helper has everything it needs.
		a.clearPreparedUpdateState()
		wailsruntime.Quit(a.ctx)
		return nil
	}

	// If another version was prepared previously, discard it and download fresh.
	a.clearPreparedUpdateState()

	wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Starting update…"})

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %w", err)
	}
	exePath = filepath.Clean(exePath)

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
	artifactDir := filepath.Dir(a.preparedUpdateStatePath())
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		return err
	}

	artifactPath, shaHex, err := downloadUpdateArtifact(artifactURL, artifactDir, func(written, total int64) {
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

	// Persist prepared update on disk so we can apply it later.
	_ = a.savePreparedUpdateState(preparedUpdateState{
		Version:    latestVersion,
		Artifact:   artifactPath,
		Sha256:     shaHex,
		UpdatedAt:  time.Now().Format(time.RFC3339),
		Downloaded: true,
	})

	wailsruntime.EventsEmit(a.ctx, "update:ready", map[string]any{"version": latestVersion})
	wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Update downloaded. Restart to install."})
	return nil
}

// ClearPreparedUpdate removes any downloaded-but-not-applied update artifact/state.
// Safe to call even if no update is prepared.
func (a *App) ClearPreparedUpdate() {
	a.clearPreparedUpdateState()
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "update:status", map[string]any{"message": "Cleared prepared update."})
	}
}

func downloadUpdateArtifact(url string, destDir string, onProgress func(written, total int64)) (path string, sha256Hex string, err error) {
	pattern := "rawrequest-update-artifact-*" + archiveSuffixFromURL(url)
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

	if strings.TrimSpace(destDir) == "" {
		destDir = ""
	}
	tmp, err := os.CreateTemp(destDir, pattern)
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

func archiveSuffixFromURL(url string) string {
	lower := strings.ToLower(strings.TrimSpace(url))
	switch {
	case strings.HasSuffix(lower, ".tar.gz"):
		return ".tar.gz"
	case strings.HasSuffix(lower, ".tgz"):
		return ".tgz"
	case strings.HasSuffix(lower, ".zip"):
		return ".zip"
	default:
		return ""
	}
}

func ensureInstallParentDirWritable(installPath string) error {
	parent := installPath
	if strings.HasSuffix(strings.ToLower(installPath), ".app") {
		parent = filepath.Dir(installPath)
	}
	if parent == "" {
		return errors.New("could not determine install parent directory")
	}
	probe := filepath.Join(parent, ".rawrequest-write-probe")
	f, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_ = f.Close()
	return os.Remove(probe)
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
