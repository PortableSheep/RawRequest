//go:build !windows

package main

// refreshCLICopyBestEffort is a no-op on non-Windows platforms.
// On macOS the CLI uses a symlink that survives app bundle replacement.
func refreshCLICopyBestEffort(_ string) {}
