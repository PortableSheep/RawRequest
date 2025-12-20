//go:build tools
// +build tools

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetExamplesForFirstRun(t *testing.T) {
	app := NewApp()
	// Ensure first-run flag is removed for this test
	appDir := app.getAppDir()
	flag := filepath.Join(appDir, ".first-run-completed")
	_ = os.Remove(flag)

	resp, err := app.GetExamplesForFirstRun()
	if err != nil {
		t.Fatalf("Error calling GetExamplesForFirstRun: %v", err)
	}
	if !resp.IsFirstRun {
		t.Fatalf("Expected IsFirstRun to be true, got false")
	}
	if len(resp.Content) == 0 {
		t.Fatalf("Expected non-empty content")
	}

	// Mark and call again
	if err := app.MarkFirstRunComplete(); err != nil {
		t.Fatalf("MarkFirstRunComplete error: %v", err)
	}

	resp2, err := app.GetExamplesForFirstRun()
	if err != nil {
		t.Fatalf("Error calling GetExamplesForFirstRun after mark: %v", err)
	}
	if resp2.IsFirstRun {
		t.Fatalf("Expected IsFirstRun false after marking completed")
	}
}
