//go:build darwin

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// refreshCLICopyBestEffort repairs CLI symlinks that may have broken
// during the app-bundle swap. install.sh creates a symlink such as
// /usr/local/bin/rawrequest -> /Applications/RawRequest.app/Contents/MacOS/RawRequest.
// After the updater renames the old .app and moves the new one into place
// the symlink path is the same, but we verify it actually resolves and
// recreate it if it doesn't.
func refreshCLICopyBestEffort(installPath string) {
	if !strings.HasSuffix(strings.ToLower(installPath), ".app") {
		return
	}

	binaryPath := filepath.Join(installPath, "Contents", "MacOS", "RawRequest")
	if _, err := os.Stat(binaryPath); err != nil {
		return
	}

	candidates := cliSymlinkCandidates()
	for _, linkPath := range candidates {
		repairCLISymlink(linkPath, binaryPath)
	}
}

// cliSymlinkCandidates returns directories where install.sh may have placed
// a "rawrequest" symlink.
func cliSymlinkCandidates() []string {
	paths := []string{
		"/usr/local/bin/rawrequest",
		"/opt/homebrew/bin/rawrequest",
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, ".local", "bin", "rawrequest"))
	}
	return paths
}

// repairCLISymlink checks whether linkPath is a symlink whose target is
// missing or points into a backup .app bundle, and recreates it pointing
// to targetPath.
func repairCLISymlink(linkPath, targetPath string) {
	fi, err := os.Lstat(linkPath)
	if err != nil {
		return // doesn't exist
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		return // not a symlink, leave it alone
	}

	currentTarget, err := os.Readlink(linkPath)
	if err != nil {
		return
	}

	// Already correct.
	if currentTarget == targetPath {
		return
	}

	// If the symlink resolves and doesn't point at a stale backup, leave it.
	if _, err := os.Stat(linkPath); err == nil && !strings.Contains(currentTarget, ".bak-") {
		return
	}

	// Symlink is broken or points at a backup — repair it.
	fmt.Printf("Repairing CLI symlink %s -> %s\n", linkPath, targetPath)
	if err := os.Remove(linkPath); err != nil {
		fmt.Printf("Warning: could not remove old symlink %s: %v\n", linkPath, err)
		return
	}
	if err := os.Symlink(targetPath, linkPath); err != nil {
		fmt.Printf("Warning: could not create symlink %s -> %s: %v\n", linkPath, targetPath, err)
	}
}
