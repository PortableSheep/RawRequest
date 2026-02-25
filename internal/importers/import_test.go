package importers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectFormat_PostmanJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "collection.json")
	data := []byte(`{"info":{"name":"Test"},"item":[]}`)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	format, err := DetectFormat(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if format != "postman" {
		t.Fatalf("expected postman, got %s", format)
	}
}

func TestDetectFormat_BrunoDir(t *testing.T) {
	dir := t.TempDir()
	bruFile := filepath.Join(dir, "request.bru")
	if err := os.WriteFile(bruFile, []byte("meta {\n  name: test\n}\n"), 0644); err != nil {
		t.Fatal(err)
	}

	format, err := DetectFormat(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if format != "bruno" {
		t.Fatalf("expected bruno, got %s", format)
	}
}

func TestDetectFormat_EmptyDir(t *testing.T) {
	dir := t.TempDir()

	_, err := DetectFormat(dir)
	if err == nil {
		t.Fatal("expected error for empty directory")
	}
}

func TestDetectFormat_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(path, []byte("not json"), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := DetectFormat(path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
