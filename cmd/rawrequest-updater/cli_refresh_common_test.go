package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsServiceLauncherScript(t *testing.T) {
	script := windowsServiceLauncherScript()
	if !bytes.Contains(script, []byte("rawrequest.exe")) {
		t.Fatalf("expected script to reference rawrequest.exe, got %q", string(script))
	}
	if !bytes.Contains(script, []byte("service %*")) {
		t.Fatalf("expected script to pass through args, got %q", string(script))
	}
}

func TestWriteFileIfChanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rawrequest-service.cmd")
	first := []byte("first")
	second := []byte("second")

	if err := writeFileIfChanged(path, first, 0o644); err != nil {
		t.Fatalf("write first failed: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read first failed: %v", err)
	}
	if !bytes.Equal(got, first) {
		t.Fatalf("unexpected first content: %q", string(got))
	}

	if err := writeFileIfChanged(path, first, 0o644); err != nil {
		t.Fatalf("rewrite same failed: %v", err)
	}
	got, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("read same failed: %v", err)
	}
	if !bytes.Equal(got, first) {
		t.Fatalf("content changed unexpectedly: %q", string(got))
	}

	if err := writeFileIfChanged(path, second, 0o644); err != nil {
		t.Fatalf("write second failed: %v", err)
	}
	got, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("read second failed: %v", err)
	}
	if !bytes.Equal(got, second) {
		t.Fatalf("unexpected second content: %q", string(got))
	}
}
