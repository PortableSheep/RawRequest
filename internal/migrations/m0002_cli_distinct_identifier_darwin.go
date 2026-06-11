//go:build darwin

package migrations

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"strings"
)

// MigrationCLIDistinctIdentifier is the ID of the macOS CLI re-sign migration.
// Exported so callers/tests can reference it stably.
const MigrationCLIDistinctIdentifier = "0002_cli_distinct_identifier"

// cliDistinctIdentifier is the code-signing identifier we want every
// standalone `rawrequest` CLI binary to advertise. It must differ from the
// GUI bundle's CFBundleIdentifier (dev.rawrequest.app) so macOS
// LaunchServices does not treat a long-lived `rawrequest mcp` child as the
// running instance of the bundle. When the identifiers collide, GUI launches
// of RawRequest.app are routed to the headless child and time out.
const cliDistinctIdentifier = "dev.rawrequest.cli"

func init() {
	Default.MustRegister(Migration{
		ID:          MigrationCLIDistinctIdentifier,
		Description: "Re-sign the standalone macOS rawrequest CLI binary with a distinct ad-hoc code-signing identifier so headless rawrequest mcp/service processes are not conflated with the GUI bundle by LaunchServices",
		Apply:       applyCLIDistinctIdentifier,
	})
}

// applyCLIDistinctIdentifier is the registered Migration.Apply.
func applyCLIDistinctIdentifier(ctx context.Context) error {
	return runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
		candidates:         defaultCLICandidates(),
		identifier:         cliDistinctIdentifier,
		codesign:           adhocCodesign,
		readIdent:          readCodesignIdentifier,
		privilegedCodesign: privilegedAdhocCodesign,
		canWrite:           canWriteFile,
	})
}

// cliDistinctIdentifierConfig isolates side effects so the migration's
// logic is hermetically testable.
type cliDistinctIdentifierConfig struct {
	candidates []string
	identifier string
	// codesign performs an ad-hoc resign of path with the given identifier.
	codesign func(path, identifier string) error
	// readIdent reports the current code-signing identifier of path. It must
	// return ("", nil) when the file is unsigned or codesign is unavailable.
	readIdent func(path string) (string, error)
	// privilegedCodesign retries the resign with administrator privileges
	// (typically via osascript). Optional; when nil, permission failures
	// bubble up and the migration retries on the next launch.
	privilegedCodesign func(path, identifier string) error
	// canWrite reports whether the calling process can mutate path's
	// contents. Used to choose between the unprivileged and privileged
	// codesign paths up front, because codesign(1) reports permission
	// denials as the opaque "internal error in Code Signing subsystem"
	// rather than EACCES, so we cannot rely on its error to detect that
	// case after the fact.
	canWrite func(path string) bool
}

// runCLIDistinctIdentifier inspects each candidate path and re-signs it
// with the configured identifier when needed. Failures are collected and
// returned so the runner retries on the next launch.
func runCLIDistinctIdentifier(cfg cliDistinctIdentifierConfig) error {
	if cfg.identifier == "" {
		return fmt.Errorf("identifier must be set")
	}
	if cfg.codesign == nil {
		return fmt.Errorf("codesign func must be set")
	}

	var anyFailed []string
	for _, path := range cfg.candidates {
		if shouldResignCLI(path, cfg.identifier, cfg.readIdent) != resignActionResign {
			continue
		}

		// /usr/local/bin/rawrequest is typically root-owned on installs
		// that ran scripts/install.sh with sudo. codesign(1) does not
		// surface a usable EACCES in that case (it reports an opaque
		// "internal error in Code Signing subsystem"), so we gate the
		// path choice on writability up front.
		writable := true
		if cfg.canWrite != nil {
			writable = cfg.canWrite(path)
		}

		if writable {
			if err := cfg.codesign(path, cfg.identifier); err == nil {
				continue
			} else if cfg.privilegedCodesign == nil {
				anyFailed = append(anyFailed, fmt.Sprintf("%s: %v", path, err))
				continue
			}
			// fall through to privileged retry
		}

		if cfg.privilegedCodesign == nil {
			anyFailed = append(anyFailed, fmt.Sprintf("%s: not writable and no privileged fallback", path))
			continue
		}
		if perr := cfg.privilegedCodesign(path, cfg.identifier); perr != nil {
			anyFailed = append(anyFailed, fmt.Sprintf("%s (privileged): %v", path, perr))
		}
	}
	if len(anyFailed) > 0 {
		return fmt.Errorf("CLI re-sign failed: %s", strings.Join(anyFailed, "; "))
	}
	return nil
}

type resignAction int

const (
	resignActionSkip resignAction = iota
	resignActionResign
)

// shouldResignCLI decides whether path needs to be re-signed.
//
// We re-sign only when:
//   - path exists and is a regular file (never a symlink — those belong to
//     migration 0001, and a symlink-into-bundle scenario means re-signing
//     would mutate the bundle binary itself).
//   - path's current code-signing identifier is not already the desired one.
//
// readIdent errors are treated as "unknown identifier", which causes a
// resign attempt. That keeps the migration self-healing on machines where
// a previous resign attempt was interrupted.
func shouldResignCLI(path, want string, readIdent func(string) (string, error)) resignAction {
	fi, err := os.Lstat(path)
	if err != nil {
		return resignActionSkip
	}
	if fi.Mode()&fs.ModeSymlink != 0 {
		return resignActionSkip
	}
	if !fi.Mode().IsRegular() {
		return resignActionSkip
	}
	if readIdent != nil {
		if got, _ := readIdent(path); got == want {
			return resignActionSkip
		}
	}
	return resignActionResign
}

// adhocCodesign invokes the system codesign(1) tool to ad-hoc sign path
// with the given identifier. Ad-hoc signing (`-s -`) does not require a
// keychain identity and works on user machines and CI alike.
//
// `--force` makes the call idempotent: an existing signature is replaced.
func adhocCodesign(path, identifier string) error {
	cmd := exec.Command("codesign", "--force", "--sign", "-", "--identifier", identifier, path)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("codesign: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// readCodesignIdentifier returns the embedded code-signing identifier
// reported by `codesign -dv` for path. Returns ("", nil) when the binary
// is unsigned or codesign is unavailable, so callers treat that case as
// "needs resigning".
func readCodesignIdentifier(path string) (string, error) {
	cmd := exec.Command("codesign", "-dv", path)
	out, err := cmd.CombinedOutput()
	if err != nil {
		// codesign exits non-zero for unsigned binaries; fall through and
		// parse what we have. The output goes to stderr but CombinedOutput
		// captures it.
	}
	for _, line := range strings.Split(string(out), "\n") {
		const prefix = "Identifier="
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix)), nil
		}
	}
	return "", nil
}

// canWriteFile reports whether the calling process can mutate path's
// contents. Used as the writability gate before invoking codesign(1),
// which on macOS reports permission denials as the opaque "internal
// error in Code Signing subsystem" rather than EACCES.
//
// We open with O_WRONLY (no O_TRUNC, no O_CREATE) so a successful open
// doesn't damage the file. Any error — permission denied, file busy,
// missing — yields false.
func canWriteFile(path string) bool {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// privilegedAdhocCodesign re-signs path with administrator privileges
// via `osascript ... with administrator privileges`. Used when path is
// not writable by the current user (typically /usr/local/bin/rawrequest
// owned by root after a sudo install).
//
// We invoke /usr/bin/codesign directly so the AppleScript admin prompt
// shell environment is irrelevant to PATH lookup.
func privilegedAdhocCodesign(path, identifier string) error {
	script := fmt.Sprintf(
		`do shell script "/usr/bin/codesign --force --sign - --identifier %s %s" with administrator privileges`,
		osaShellQuote(identifier),
		osaShellQuote(path),
	)
	cmd := exec.Command("osascript", "-e", script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("osascript: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// osaShellQuote wraps s in single quotes, escaping any embedded single
// quotes, for safe inclusion in a `do shell script` AppleScript string.
// The AppleScript string itself uses double quotes so single-quoting
// inside is safe. Renamed from m0001's shellQuote to avoid duplicate
// symbols across the build-tagged files in this package.
func osaShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
