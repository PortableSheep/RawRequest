package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveFileHistoryToDir(t *testing.T) {
	app := NewApp()
	tmp := t.TempDir()
	fileID := "unsaved:tab-123"
	history := "[{\"timestamp\":\"2025-01-01T00:00:00Z\",\"method\":\"GET\"}]"

	app.SaveFileHistoryToDir(fileID, history, tmp)

	p := filepath.Join(tmp, "history", app.sanitizeFileID(fileID)+".json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("expected history file to be written, got error: %v", err)
	}
	if string(data) != history {
		t.Fatalf("history content mismatch, got: %s", string(data))
	}
}

func TestSaveFileHistoryToRunLocation(t *testing.T) {
	app := NewApp()
	tmp := t.TempDir()
	oldwd, _ := os.Getwd()
	defer os.Chdir(oldwd)
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("failed to chdir to temp: %v", err)
	}
	fileID := "unsaved:tab-runloc"
	history := "[{\"timestamp\":\"2025-01-01T00:00:00Z\",\"method\":\"POST\"}]"

	app.SaveFileHistoryToRunLocation(fileID, history)

	p := filepath.Join(tmp, "history", app.sanitizeFileID(fileID)+".json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("expected history file to be written in run location, got error: %v", err)
	}
	if string(data) != history {
		t.Fatalf("history content mismatch in run location, got: %s", string(data))
	}
}
