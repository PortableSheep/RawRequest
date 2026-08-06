//go:build darwin

package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// refreshCLICopyBestEffort installs / refreshes the standalone `rawrequest`
// CLI binary at the well-known PATH locations after a successful update.
//
// Two install layouts are possible on disk:
//   - Legacy (pre-1.4.x install.sh): a symlink at e.g. /usr/local/bin/rawrequest
//     pointing into RawRequest.app/Contents/MacOS/RawRequest. Symlinking the
//     CLI inside the .app bundle causes macOS LaunchServices to register
//     CLI/MCP child processes as the bundle's running instance, which
//     prevents the GUI from launching while the MCP child is alive
//     (e.g. via Claude). We replace these symlinks with a real-file copy.
//   - Current: a real file at the same path. We refresh its contents to
//     match the just-installed version so the CLI stays in lockstep
//     with the .app.
//
// Sources are preferred in this order:
//  1. The standalone `rawrequest` binary shipped at the top of the
//     extracted tarball (sibling of RawRequest.app inside stagingDir).
//  2. Fallback: the binary inside the newly-installed .app bundle.
func refreshCLICopyBestEffort(installPath, stagingDir string) {
	if !strings.HasSuffix(strings.ToLower(installPath), ".app") {
		return
	}

	src := findStandaloneCLIInStaging(stagingDir)
	if src == "" {
		src = filepath.Join(installPath, "Contents", "MacOS", "RawRequest")
	}
	if _, err := os.Stat(src); err != nil {
		return
	}

	for _, candidate := range cliSymlinkCandidates() {
		refreshCLIBinary(candidate, src)
	}
}

// findStandaloneCLIInStaging searches stagingDir for a regular file
// named `rawrequest` that is NOT inside a `.app` directory. The
// release tarball ships the standalone CLI as a sibling of the
// RawRequest.app bundle, so that's where we expect to find it.
func findStandaloneCLIInStaging(stagingDir string) string {
	if stagingDir == "" {
		return ""
	}
	var found string
	stop := errors.New("found")
	_ = filepath.WalkDir(stagingDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasSuffix(strings.ToLower(d.Name()), ".app") {
				return fs.SkipDir
			}
			return nil
		}
		if d.Name() != "rawrequest" {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		found = path
		return stop
	})
	return found
}

// refreshCLIBinary inspects path and replaces it with a real-file copy
// of srcBinary when appropriate:
//   - missing     → leave alone (user uninstalled the CLI)
//   - symlink     → always replace with real file (eliminates the
//     LaunchServices bundle-registration bug)
//   - regular     → refresh contents in place so the CLI stays in
//     lockstep with the new .app
//   - other type  → leave alone
//
// EACCES failures (root-owned dirs like /usr/local/bin) trigger a
// privileged retry via `osascript … with administrator privileges`,
// which prompts the user once.
func refreshCLIBinary(path, srcBinary string) {
	fi, err := os.Lstat(path)
	if err != nil {
		return
	}

	mode := fi.Mode()
	switch {
	case mode&os.ModeSymlink != 0:
		// Only replace symlinks that resolve into a .app bundle —
		// those are the ones we (or a previous install.sh) wrote.
		// Leave user-managed symlinks (e.g. pointing at a dev build)
		// alone.
		target, rerr := os.Readlink(path)
		if rerr != nil || !strings.Contains(strings.ToLower(target), ".app/contents/macos/") {
			return
		}
	case mode.IsRegular():
		// refresh contents
	default:
		return
	}

	err = installRealFile(path, srcBinary)
	if err == nil {
		ensureCLIIdentifier(path)
		return
	}
	if !isPermissionDenied(err) {
		fmt.Printf("Warning: refreshing CLI at %s: %v\n", path, err)
		return
	}

	fmt.Printf("Elevated permissions needed to refresh %s; requesting admin access...\n", path)
	if perr := installRealFilePrivileged(path, srcBinary); perr != nil {
		fmt.Printf("Warning: privileged CLI refresh failed for %s: %v\n", path, perr)
	}
}

// ensureCLIIdentifier ad-hoc resigns the standalone CLI at path with the
// distinct identifier dev.rawrequest.cli. This keeps macOS LaunchServices
// from conflating headless `rawrequest mcp` / `rawrequest service`
// processes with the GUI bundle (CFBundleIdentifier=dev.rawrequest.app),
// which would otherwise prevent GUI launches while the MCP child is
// alive. Mirrors internal/migrations/m0002_cli_distinct_identifier_darwin.go.
//
// Failures are best-effort: the migration framework will retry on the
// next GUI launch.
func ensureCLIIdentifier(path string) {
	cmd := exec.Command("codesign", "--force", "--sign", "-", "--identifier", "dev.rawrequest.cli", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Printf("Warning: ad-hoc resign of %s failed: %v: %s\n", path, err, strings.TrimSpace(string(out)))
	}
}

// cliSymlinkCandidates returns the well-known paths where install.sh may
// have placed a `rawrequest` CLI entry. The entries may be either
// symlinks (legacy) or regular files (current layout).
func cliSymlinkCandidates() []string {
	paths := []string{
		"/usr/local/bin/rawrequest",
		"/opt/homebrew/bin/rawrequest",
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		paths = append(paths, filepath.Join(home, ".local", "bin", "rawrequest"))
	}
	return paths
}

// installRealFile atomically replaces path (whether file or symlink)
// with a regular-file copy of srcBinary. The destination's parent
// directory must exist and be writable by the caller.
func installRealFile(path, srcBinary string) error {
	srcF, err := os.Open(srcBinary)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer srcF.Close()

	dir := filepath.Dir(path)
	tmpF, err := os.CreateTemp(dir, ".rawrequest.cli.*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmpF.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }

	if _, err := io.Copy(tmpF, srcF); err != nil {
		_ = tmpF.Close()
		cleanup()
		return err
	}
	if err := tmpF.Sync(); err != nil {
		_ = tmpF.Close()
		cleanup()
		return err
	}
	if err := tmpF.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		cleanup()
		return err
	}
	return nil
}

// installRealFilePrivileged stages srcBinary in a user-writable temp
// directory and runs cp/chmod under `osascript with administrator
// privileges` to land it at path. Used when the unprivileged install
// fails with EACCES.
func installRealFilePrivileged(path, srcBinary string) error {
	tmpDir, err := os.MkdirTemp("", "rawrequest-cli-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	stage := filepath.Join(tmpDir, "rawrequest")
	if err := stageBinary(srcBinary, stage); err != nil {
		return fmt.Errorf("stage binary: %w", err)
	}

	script := fmt.Sprintf(
		`do shell script "rm -f %s && cp -f %s %s && chmod 0755 %s && /usr/bin/codesign --force --sign - --identifier dev.rawrequest.cli %s" with administrator privileges`,
		osaQuote(path),
		osaQuote(stage),
		osaQuote(path),
		osaQuote(path),
		osaQuote(path),
	)
	cmd := exec.Command("osascript", "-e", script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func stageBinary(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func osaQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func isPermissionDenied(err error) bool {
	for err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return true
		}
		var u interface{ Unwrap() error }
		if errors.As(err, &u) {
			err = u.Unwrap()
			continue
		}
		break
	}
	return false
}
