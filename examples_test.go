package main

import (
	"os"
	"testing"
)

func TestGetExamplesForFirstRun_IsolatedHomeDir(t *testing.T) {
	// Prevent tests from reading/writing the user's real app dir.
	origHome := os.Getenv("HOME")
	t.Cleanup(func() {
		_ = os.Setenv("HOME", origHome)
	})
	_ = os.Setenv("HOME", t.TempDir())

	app := NewApp()

	resp, err := app.GetExamplesForFirstRun()
	if err != nil {
		t.Fatalf("GetExamplesForFirstRun error: %v", err)
	}
	if !resp.IsFirstRun {
		t.Fatalf("expected first run to be true")
	}
	if len(resp.Content) == 0 {
		t.Fatalf("expected non-empty examples content")
	}

	if err := app.MarkFirstRunComplete(); err != nil {
		t.Fatalf("MarkFirstRunComplete error: %v", err)
	}

	again, err := app.GetExamplesForFirstRun()
	if err != nil {
		t.Fatalf("GetExamplesForFirstRun (after mark) error: %v", err)
	}
	if again.IsFirstRun {
		t.Fatalf("expected first run to be false after marking complete")
	}
}

func TestGetExamplesFile_AlwaysReturnsContent(t *testing.T) {
	origHome := os.Getenv("HOME")
	t.Cleanup(func() {
		_ = os.Setenv("HOME", origHome)
	})
	_ = os.Setenv("HOME", t.TempDir())

	app := NewApp()
	resp, err := app.GetExamplesFile()
	if err != nil {
		t.Fatalf("GetExamplesFile error: %v", err)
	}
	if resp == nil || len(resp.Content) == 0 {
		t.Fatalf("expected non-empty examples content")
	}
	if resp.IsFirstRun {
		t.Fatalf("expected IsFirstRun to be false")
	}
}
