//go:build ignore

package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type options struct {
	pid             int
	installPath     string
	artifactURL     string
	expectedSHA     string
	relaunch        bool
	waitTimeout     time.Duration
	downloadTimeout time.Duration
}

var errFoundPayload = errors.New("found")

func main() {
	var opts options
	flag.IntVar(&opts.pid, "pid", 0, "PID of RawRequest process to wait for before swapping")
	flag.StringVar(&opts.installPath, "install-path", "", "Install path to update (macOS: /path/RawRequest.app, Windows: install directory)")
	flag.StringVar(&opts.artifactURL, "artifact-url", "", "URL to the release artifact (macOS: .tar.gz containing RawRequest.app, Windows: .zip)")
	flag.StringVar(&opts.expectedSHA, "sha256", "", "Expected SHA-256 of the downloaded artifact (hex). Optional in MVP")
	flag.BoolVar(&opts.relaunch, "relaunch", true, "Relaunch after successful update")
	flag.DurationVar(&opts.waitTimeout, "wait-timeout", 2*time.Minute, "Max time to wait for the main app to exit")
	flag.DurationVar(&opts.downloadTimeout, "download-timeout", 2*time.Minute, "Download timeout")
	flag.Parse()

	if opts.installPath == "" {
		die("missing --install-path")
	}
	if opts.artifactURL == "" {
		die("missing --artifact-url")
	}

	installPath, err := filepath.Abs(opts.installPath)
	if err != nil {
		dief("failed to resolve install path: %v", err)
	}

	parentDir := installParentDir(installPath)
	if parentDir == "" {
		die("could not determine install parent directory")
	}

	if err := ensureDirWritable(parentDir); err != nil {
		dief("install location not writable (MVP requires user-writable installs): %v", err)
	}

	stamp := time.Now().UTC().Format("20060102T150405Z")
	stagingDir := filepath.Join(parentDir, ".rawrequest-staging-"+stamp)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		dief("failed to create staging dir: %v", err)
	}
	defer func() {
		_ = os.RemoveAll(stagingDir)
	}()

	tmpDir, err := os.MkdirTemp("", "rawrequest-updater-")
	if err != nil {
		dief("failed to create temp dir: %v", err)
	}
	defer func() {
		_ = os.RemoveAll(tmpDir)
	}()

	artifactPath := filepath.Join(tmpDir, "artifact")
	fmt.Printf("Downloading %s...\n", opts.artifactURL)
	if err := downloadFile(opts.artifactURL, artifactPath, opts.downloadTimeout); err != nil {
		dief("download failed: %v", err)
	}

	if opts.expectedSHA != "" {
		fmt.Printf("Verifying sha256...\n")
		if err := verifySHA256(artifactPath, opts.expectedSHA); err != nil {
			dief("sha256 verification failed: %v", err)
		}
	} else {
		fmt.Printf("Warning: no sha256 provided; skipping integrity verification (MVP).\n")
	}

	fmt.Printf("Extracting to staging...\n")
	artifactLower := strings.ToLower(opts.artifactURL)
	switch {
	case strings.HasSuffix(artifactLower, ".tar.gz") || strings.HasSuffix(artifactLower, ".tgz"):
		if err := extractTarGz(artifactPath, stagingDir); err != nil {
			dief("failed to extract tar.gz: %v", err)
		}
	case strings.HasSuffix(artifactLower, ".zip"):
		if err := extractZip(artifactPath, stagingDir); err != nil {
			dief("failed to extract zip: %v", err)
		}
	default:
		die("unsupported artifact type (expected .tar.gz/.tgz or .zip)")
	}

	newPayloadPath, err := findNewPayloadPath(stagingDir)
	if err != nil {
		dief("could not locate extracted app payload: %v", err)
	}

	if opts.pid != 0 {
		fmt.Printf("Waiting for PID %d to exit...\n", opts.pid)
		if err := waitForPIDExit(opts.pid, opts.waitTimeout); err != nil {
			dief("timed out waiting for app to exit: %v", err)
		}
	}

	fmt.Printf("Applying update...\n")
	if err := applyUpdate(installPath, newPayloadPath); err != nil {
		dief("apply update failed: %v", err)
	}

	fmt.Printf("Update applied successfully.\n")
	if opts.relaunch {
		fmt.Printf("Relaunching...\n")
		if err := relaunch(installPath); err != nil {
			dief("relaunch failed: %v", err)
		}
	}
}

func die(msg string) {
	fmt.Fprintln(os.Stderr, "rawrequest-updater:", msg)
	os.Exit(1)
}

func dief(format string, args ...any) {
	die(fmt.Sprintf(format, args...))
}

func installParentDir(installPath string) string {
	// macOS: /path/RawRequest.app → parent directory
	if strings.HasSuffix(strings.ToLower(installPath), ".app") {
		return filepath.Dir(installPath)
	}
	// Windows / others: treat installPath as install directory
	return installPath
}

func ensureDirWritable(dir string) error {
	if dir == "" {
		return errors.New("empty directory")
	}
	probe := filepath.Join(dir, ".rawrequest-write-probe")
	f, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_ = f.Close()
	return os.Remove(probe)
}

func downloadFile(url, dst string, timeout time.Duration) error {
	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "rawrequest-updater")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func verifySHA256(path string, expectedHex string) error {
	expectedHex = strings.TrimSpace(strings.ToLower(expectedHex))
	expectedHex = strings.TrimPrefix(expectedHex, "sha256:")

	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != expectedHex {
		return fmt.Errorf("sha256 mismatch: expected %s, got %s", expectedHex, actual)
	}
	return nil
}

func extractTarGz(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}

		rel := filepath.Clean(hdr.Name)
		// Prevent path traversal
		if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			continue
		}
		target := filepath.Join(dest, rel)

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		case tar.TypeSymlink:
			// Skip symlinks in MVP (keeps extraction simple and safer)
			continue
		default:
			continue
		}
	}
	return nil
}

func extractZip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		rel := filepath.Clean(f.Name)
		if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			continue
		}

		target := filepath.Join(dest, rel)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			out.Close()
			rc.Close()
			return err
		}
		out.Close()
		rc.Close()
	}
	return nil
}

func findNewPayloadPath(stagingDir string) (string, error) {
	if runtime.GOOS == "darwin" {
		var appPath string
		err := filepath.WalkDir(stagingDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() && strings.HasSuffix(strings.ToLower(d.Name()), ".app") {
				appPath = path
				return fs.SkipDir
			}
			return nil
		})
		if err != nil {
			return "", err
		}
		if appPath == "" {
			return "", errors.New("no .app bundle found")
		}
		return appPath, nil
	}

	// Windows/other: find a directory containing RawRequest.exe
	var exeDir string
	err := filepath.WalkDir(stagingDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := strings.ToLower(d.Name())
		if name == "rawrequest.exe" {
			exeDir = filepath.Dir(path)
			return errFoundPayload
		}
		return nil
	})
	if err != nil && !errors.Is(err, errFoundPayload) {
		return "", err
	}
	if exeDir == "" {
		return "", errors.New("RawRequest.exe not found")
	}
	return exeDir, nil
}

func applyUpdate(installPath, newPayloadPath string) error {
	stamp := time.Now().UTC().Format("20060102T150405Z")

	if runtime.GOOS == "darwin" {
		backup := installPath + ".bak-" + stamp
		if _, err := os.Stat(installPath); err == nil {
			if err := os.Rename(installPath, backup); err != nil {
				return fmt.Errorf("failed to backup existing app: %w", err)
			}
		}
		if err := os.Rename(newPayloadPath, installPath); err != nil {
			_ = os.Rename(backup, installPath)
			return fmt.Errorf("failed to move new app into place: %w", err)
		}
		return nil
	}

	// Windows/other: installPath is install directory; newPayloadPath is extracted directory
	backup := installPath + ".old-" + stamp
	if _, err := os.Stat(installPath); err == nil {
		if err := os.Rename(installPath, backup); err != nil {
			return fmt.Errorf("failed to backup existing install dir: %w", err)
		}
	}
	if err := os.Rename(newPayloadPath, installPath); err != nil {
		_ = os.Rename(backup, installPath)
		return fmt.Errorf("failed to move new install into place: %w", err)
	}
	return nil
}

func relaunch(installPath string) error {
	if runtime.GOOS == "darwin" {
		cmd := execCommand("open", installPath)
		return cmd.Start()
	}

	exe := filepath.Join(installPath, "RawRequest.exe")
	cmd := execCommand(exe)
	return cmd.Start()
}

























































































































































































































































































































































































































}	return cmd.Start()	cmd := execCommand(exe)	exe := filepath.Join(installPath, "RawRequest.exe")	}		return cmd.Start()		cmd := execCommand("open", installPath)		// Use 'open' for app bundles	if runtime.GOOS == "darwin" {func relaunch(installPath string) error {}	return nil	}		return fmt.Errorf("failed to move new install into place: %w", err)		_ = os.Rename(backup, installPath)	if err := os.Rename(newPayloadPath, installPath); err != nil {	}		}			return fmt.Errorf("failed to backup existing install dir: %w", err)		if err := os.Rename(installPath, backup); err != nil {	if _, err := os.Stat(installPath); err == nil {	backup := installPath + ".old-" + stamp	// Windows/other: installPath is install directory; newPayloadPath is extracted directory	}		return nil		}			return fmt.Errorf("failed to move new app into place: %w", err)			_ = os.Rename(backup, installPath)			// Attempt rollback		if err := os.Rename(newPayloadPath, installPath); err != nil {		}			}				return fmt.Errorf("failed to backup existing app: %w", err)			if err := os.Rename(installPath, backup); err != nil {		if _, err := os.Stat(installPath); err == nil {		backup := installPath + ".bak-" + stamp		// installPath is /.../RawRequest.app; newPayloadPath is /.../staging/.../RawRequest.app	if runtime.GOOS == "darwin" {	stamp := time.Now().UTC().Format("20060102T150405Z")func applyUpdate(installPath, parentDir, newPayloadPath string) error {}	return exeDir, nil	}		return "", errors.New("RawRequest.exe not found")	if exeDir == "" {	}		return "", err	if err != nil && err.Error() != "found" {	})		return nil		}			return errors.New("found")			exeDir = filepath.Dir(path)		if name == "rawrequest.exe" {		name := strings.ToLower(d.Name())		}			return nil		if d.IsDir() {		}			return err		if err != nil {	err := filepath.WalkDir(stagingDir, func(path string, d fs.DirEntry, err error) error {	var exeDir string	// Windows/other: find a directory containing RawRequest.exe	}		return appPath, nil		}			return "", errors.New("no .app bundle found")		if appPath == "" {		}			return "", err		if err != nil {		})			return nil			}				return fs.SkipDir				appPath = path			if d.IsDir() && strings.HasSuffix(strings.ToLower(d.Name()), ".app") {			}				return err			if err != nil {		err := filepath.WalkDir(stagingDir, func(path string, d fs.DirEntry, err error) error {		var appPath string	if runtime.GOOS == "darwin" {func findNewPayloadPath(stagingDir string) (string, error) {}	return nil	}		rc.Close()		out.Close()		}			return err			rc.Close()			out.Close()		if _, err := io.Copy(out, rc); err != nil {		}			return err			rc.Close()		if err != nil {		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())		}			return err		if err != nil {		rc, err := f.Open()		}			return err		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {		}			continue			}				return err			if err := os.MkdirAll(target, 0o755); err != nil {		if f.FileInfo().IsDir() {		target := filepath.Join(dest, rel)		}			continue		if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {		rel := filepath.Clean(f.Name)	for _, f := range r.File {	defer r.Close()	}		return err	if err != nil {	r, err := zip.OpenReader(src)func extractZip(src, dest string) error {}	return nil	}		}			continue		default:			continue			// Skip symlinks in MVP (keeps extraction simple and safer)		case tar.TypeSymlink:			out.Close()			}				return err				out.Close()			if _, err := io.Copy(out, tr); err != nil {			}				return err			if err != nil {			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(hdr.Mode))			}				return err			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {		case tar.TypeReg:			}				return err			if err := os.MkdirAll(target, 0o755); err != nil {		case tar.TypeDir:		switch hdr.Typeflag {		target := filepath.Join(dest, rel)		}			continue		if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {		// Prevent path traversal		rel := filepath.Clean(hdr.Name)		}			return err		if err != nil {		}			break		if errors.Is(err, io.EOF) {		hdr, err := tr.Next()	for {	tr := tar.NewReader(gzr)	defer gzr.Close()	}		return err	if err != nil {	gzr, err := gzip.NewReader(f)	defer f.Close()	}		return err	if err != nil {	f, err := os.Open(src)func extractTarGz(src, dest string) error {}	return nil	}		return fmt.Errorf("sha256 mismatch: expected %s, got %s", expectedHex, actual)	if actual != expectedHex {	actual := hex.EncodeToString(h.Sum(nil))	}		return err	if _, err := io.Copy(h, f); err != nil {	h := sha256.New()	defer f.Close()	}		return err	if err != nil {	f, err := os.Open(path)	expectedHex = strings.TrimPrefix(expectedHex, "sha256:")	expectedHex = strings.TrimSpace(strings.ToLower(expectedHex))func verifySHA256(path string, expectedHex string) error {}	return err	_, err = io.Copy(out, resp.Body)	defer out.Close()	}		return err	if err != nil {	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)	}		return fmt.Errorf("unexpected HTTP status %d", resp.StatusCode)	if resp.StatusCode < 200 || resp.StatusCode >= 300 {	defer resp.Body.Close()	}		return err	if err != nil {	resp, err := client.Do(req)	req.Header.Set("User-Agent", "rawrequest-updater")	}		return err	if err != nil {	req, err := http.NewRequest("GET", url, nil)	client := &http.Client{Timeout: timeout}func downloadFile(url, dst string, timeout time.Duration) error {}	return os.Remove(probe)	_ = f.Close()	}		return err	if err != nil {	f, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)	probe := filepath.Join(dir, ".rawrequest-write-probe")	}		return errors.New("empty directory")	if dir == "" {func ensureDirWritable(dir string) error {}	return installPath	// Windows / others: treat installPath as install directory	}		return filepath.Dir(installPath)	if strings.HasSuffix(strings.ToLower(installPath), ".app") {	// macOS: /path/RawRequest.app → parent directoryfunc installParentDir(installPath string) string {}	die(fmt.Sprintf(format, args...))func dief(format string, args ...any) {}	os.Exit(1)	fmt.Fprintln(os.Stderr, "rawrequest-updater:", msg)func die(msg string) {}	}		}			dief("relaunch failed: %v", err)		if err := relaunch(installPath); err != nil {		fmt.Printf("Relaunching...\n")	if opts.relaunch {	fmt.Printf("Update applied successfully.\n")	}		dief("apply update failed: %v", err)	if err := applyUpdate(installPath, parentDir, newPayloadPath); err != nil {	fmt.Printf("Applying update...\n")	}		}			dief("timed out waiting for app to exit: %v", err)		if err := waitForPIDExit(opts.pid, opts.waitTimeout); err != nil {		fmt.Printf("Waiting for PID %d to exit...\n", opts.pid)	if opts.pid != 0 {	}		dief("could not locate extracted app payload: %v", err)	if err != nil {	newPayloadPath, err := findNewPayloadPath(stagingDir)	}		die("unsupported artifact type (expected .tar.gz/.tgz or .zip)")	default:		}			dief("failed to extract zip: %v", err)		if err := extractZip(artifactPath, stagingDir); err != nil {	case strings.HasSuffix(artifactLower, ".zip"):		}			dief("failed to extract tar.gz: %v", err)		if err := extractTarGz(artifactPath, stagingDir); err != nil {	case strings.HasSuffix(artifactLower, ".tar.gz") || strings.HasSuffix(artifactLower, ".tgz"):	switch {	artifactLower := strings.ToLower(opts.artifactURL)	fmt.Printf("Extracting to staging...\n")	}		fmt.Printf("Warning: no sha256 provided; skipping integrity verification (MVP).\n")	} else {		}			dief("sha256 verification failed: %v", err)		if err := verifySHA256(artifactPath, opts.expectedSHA); err != nil {		fmt.Printf("Verifying sha256...\n")	if opts.expectedSHA != "" {	}		dief("download failed: %v", err)	if err := downloadFile(opts.artifactURL, artifactPath, opts.downloadTimeout); err != nil {	fmt.Printf("Downloading %s...\n", opts.artifactURL)	artifactPath := filepath.Join(tmpDir, "artifact")	}()		_ = os.RemoveAll(tmpDir)	defer func() {	}		dief("failed to create temp dir: %v", err)	if err != nil {	tmpDir, err := os.MkdirTemp("", "rawrequest-updater-")	}()		_ = os.RemoveAll(stagingDir)	defer func() {	}		dief("failed to create staging dir: %v", err)	if err := os.MkdirAll(stagingDir, 0o755); err != nil {	stagingDir := filepath.Join(parentDir, ".rawrequest-staging-"+stamp)	stamp := time.Now().UTC().Format("20060102T150405Z")	}		dief("install location not writable (MVP requires user-writable installs): %v", err)	if err := ensureDirWritable(parentDir); err != nil {	}		die("could not determine install parent directory")	if parentDir == "" {	parentDir := installParentDir(installPath)	}		dief("failed to resolve install path: %v", err)	if err != nil {	installPath, err := filepath.Abs(opts.installPath)	}		die("missing --artifact-url")	if opts.artifactURL == "" {	}		die("missing --install-path")	if opts.installPath == "" {	flag.Parse()	flag.DurationVar(&opts.downloadTimeout, "download-timeout", 2*time.Minute, "Download timeout")	flag.DurationVar(&opts.waitTimeout, "wait-timeout", 2*time.Minute, "Max time to wait for the main app to exit")	flag.BoolVar(&opts.relaunch, "relaunch", true, "Relaunch after successful update")	flag.StringVar(&opts.expectedSHA, "sha256", "", "Expected SHA-256 of the downloaded artifact (hex). Optional in MVP")	flag.StringVar(&opts.artifactURL, "artifact-url", "", "URL to the release artifact (macOS: .tar.gz containing RawRequest.app, Windows: .zip)")	flag.StringVar(&opts.installPath, "install-path", "", "Install path to update (macOS: /path/RawRequest.app, Windows: install directory)")	flag.IntVar(&opts.pid, "pid", 0, "PID of RawRequest process to wait for before swapping")	var opts optionsfunc main() {}	downloadTimeout time.Duration	waitTimeout  time.Duration	relaunch     bool	expectedSHA  string	artifactURL  string	installPath  string	pid          inttype options struct {)	"time"	"strings"	"runtime"	"path/filepath"	"os"	"net/http"	"io/fs"	"io"	"fmt"	"flag"	"errors"	"encoding/hex"	"crypto/sha256"	"compress/gzip"	"archive/zip"	"archive/tar"import (