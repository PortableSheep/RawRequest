//go:build darwin

package migrations

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// MigrationCLIRealFile is the ID of the macOS CLI symlink → real-file
// migration. Exported so callers/tests can reference it stably.
const MigrationCLIRealFile = "0001_cli_real_file"

func init() {
	Default.MustRegister(Migration{
		ID:          MigrationCLIRealFile,
		Description: "Replace macOS CLI symlinks into the .app bundle with a standalone binary copy so the rawrequest CLI/MCP does not register with LaunchServices as the bundle's running instance",
		Apply:       applyCLIRealFile,
	})
}

// applyCLIRealFile is the registered Migration.Apply. It builds the
// default config from the running process and delegates to runCLIRealFile.
func applyCLIRealFile(ctx context.Context) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve current executable: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err == nil {
		exe = resolved
	}

	// We only run when the current binary lives inside an .app bundle
	// (i.e. the GUI launched us). The standalone CLI invoking this
	// migration would have nothing to copy *from* — skip.
	if !pathInsideAppBundle(exe) {
		return nil
	}

	return runCLIRealFile(cliRealFileConfig{
		candidates:        defaultCLICandidates(),
		bundleBin:         exe,
		privilegedReplace: replacePrivilegedCopy,
	})
}

// cliRealFileConfig isolates side effects so the migration's logic is
// hermetically testable.
type cliRealFileConfig struct {
	candidates        []string
	bundleBin         string
	privilegedReplace func(targetPath, srcBinary string) error
}

// runCLIRealFile inspects each candidate path and replaces bundle-pointing
// symlinks with a real-file copy of bundleBin. Failures are collected and
// returned so the runner can decide whether to mark the migration applied.
func runCLIRealFile(cfg cliRealFileConfig) error {
	if cfg.bundleBin == "" {
		return errors.New("bundle binary path is empty")
	}
	if _, err := os.Stat(cfg.bundleBin); err != nil {
		return fmt.Errorf("bundle binary not accessible: %w", err)
	}

	var anyFailed []string
	for _, path := range cfg.candidates {
		switch classifyCLICandidate(path) {
		case cliActionReplace:
			err := replaceWithRealFile(path, cfg.bundleBin)
			if err == nil {
				continue
			}
			if !isPermissionError(err) || cfg.privilegedReplace == nil {
				anyFailed = append(anyFailed, fmt.Sprintf("%s: %v", path, err))
				continue
			}
			if perr := cfg.privilegedReplace(path, cfg.bundleBin); perr != nil {
				anyFailed = append(anyFailed, fmt.Sprintf("%s (privileged): %v", path, perr))
			}
		case cliActionSkip:
			// nothing to do
		}
	}
	if len(anyFailed) > 0 {
		// Returning non-nil keeps the migration from being marked applied,
		// so it retries on the next launch.
		return fmt.Errorf("CLI symlink replacement failed: %s", strings.Join(anyFailed, "; "))
	}
	return nil
}

type cliAction int

const (
	cliActionSkip cliAction = iota
	cliActionReplace
)

// classifyCLICandidate inspects path and decides whether it should be
// replaced with a real-file copy of the bundle binary.
//
// We replace only when path is a symlink whose target resolves inside an
// .app/Contents/MacOS/ directory. Real files and foreign symlinks are
// left strictly alone — this migration must never overwrite a CLI a user
// installed by hand.
func classifyCLICandidate(path string) cliAction {
	fi, err := os.Lstat(path)
	if err != nil {
		return cliActionSkip
	}
	if fi.Mode()&fs.ModeSymlink == 0 {
		return cliActionSkip
	}

	target, err := os.Readlink(path)
	if err != nil {
		return cliActionSkip
	}

	// Resolve relative symlinks against the link's directory.
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(path), target)
	}
	target = filepath.Clean(target)

	if pathInsideAppBundle(target) {
		return cliActionReplace
	}
	return cliActionSkip
}

// pathInsideAppBundle returns true when path (which need not exist)
// contains a `.app/Contents/MacOS` segment. Comparison is
// case-insensitive because macOS bundles are case-insensitive on
// default-formatted volumes.
func pathInsideAppBundle(path string) bool {
	lower := strings.ToLower(filepath.Clean(path))
	return strings.Contains(lower, ".app/contents/macos/")
}

// replaceWithRealFile atomically replaces path with a regular-file copy
// of srcBinary, mode 0755. The destination's parent directory must
// already exist. Any pre-existing file or symlink at path is removed.
func replaceWithRealFile(path, srcBinary string) error {
	srcF, err := os.Open(srcBinary)
	if err != nil {
		return fmt.Errorf("open source binary: %w", err)
	}
	defer srcF.Close()

	dir := filepath.Dir(path)
	tmpF, err := os.CreateTemp(dir, ".rawrequest.cli.*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpF.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }

	if _, err := io.Copy(tmpF, srcF); err != nil {
		_ = tmpF.Close()
		cleanup()
		return fmt.Errorf("copy binary: %w", err)
	}
	if err := tmpF.Sync(); err != nil {
		_ = tmpF.Close()
		cleanup()
		return fmt.Errorf("sync temp file: %w", err)
	}
	if err := tmpF.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		cleanup()
		return fmt.Errorf("chmod temp file: %w", err)
	}

	// os.Rename atomically replaces the existing entry on POSIX, including
	// when it is a symlink.
	if err := os.Rename(tmpPath, path); err != nil {
		cleanup()
		return err
	}
	return nil
}

// defaultCLICandidates returns the well-known places install.sh may have
// dropped a `rawrequest` symlink.
func defaultCLICandidates() []string {
	paths := []string{
		"/usr/local/bin/rawrequest",
		"/opt/homebrew/bin/rawrequest",
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		paths = append(paths, filepath.Join(home, ".local", "bin", "rawrequest"))
	}
	return paths
}

// isPermissionError returns true when err is or wraps a permissions
// denial. Used to decide whether to escalate via osascript.
func isPermissionError(err error) bool {
	for err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return true
		}
		// Unwrap manually because some os errors don't implement Unwrap.
		var u interface{ Unwrap() error }
		if errors.As(err, &u) {
			err = u.Unwrap()
			continue
		}
		break
	}
	return false
}

// replacePrivilegedCopy uses osascript to perform the same replacement
// with administrator privileges. Used as a fallback when the unprivileged
// path returns EACCES (e.g. /usr/local/bin owned by root).
//
// We stage the new binary in the user's temp dir first so the elevated
// shell command only needs simple cp/chmod/mv invocations — no bytes
// are exchanged through the AppleScript boundary.
func replacePrivilegedCopy(targetPath, srcBinary string) error {
	tmpDir, err := os.MkdirTemp("", "rawrequest-cli-*")
	if err != nil {
		return fmt.Errorf("create stage dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	stagePath := filepath.Join(tmpDir, "rawrequest")
	if err := copyFileMode(srcBinary, stagePath, 0o755); err != nil {
		return fmt.Errorf("stage binary: %w", err)
	}

	// Use AppleScript's "do shell script ... with administrator
	// privileges" which presents the standard macOS auth dialog.
	// We use mv -f to atomically replace whatever exists at targetPath.
	script := fmt.Sprintf(
		`do shell script "rm -f %s && cp -f %s %s && chmod 0755 %s" with administrator privileges`,
		shellQuote(targetPath),
		shellQuote(stagePath),
		shellQuote(targetPath),
		shellQuote(targetPath),
	)
	cmd := exec.Command("osascript", "-e", script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("osascript: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func copyFileMode(src, dst string, mode os.FileMode) error {
	srcF, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcF.Close()
	dstF, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dstF, srcF); err != nil {
		_ = dstF.Close()
		return err
	}
	return dstF.Close()
}

// shellQuote wraps s in single quotes, escaping any embedded single quotes,
// for safe inclusion in a `do shell script` AppleScript string. The
// AppleScript string itself uses double quotes so single-quoting inside is
// safe. Not exported.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
