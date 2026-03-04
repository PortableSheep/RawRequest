//go:build !windows && !darwin

package main

// refreshCLICopyBestEffort is a no-op on platforms other than macOS and Windows.
func refreshCLICopyBestEffort(_ string) {}
