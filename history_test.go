package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadHistoryFromResponsesDir(t *testing.T) {
	app := NewApp()
	tmp := t.TempDir()

	// Create a .responses folder with some response files
	responsesDir := filepath.Join(tmp, "test.responses")
	if err := os.MkdirAll(responsesDir, 0755); err != nil {
		t.Fatalf("failed to create responses dir: %v", err)
	}

	// Create response files with proper JSON content
	resp1 := map[string]interface{}{
		"status":       200,
		"statusText":   "OK",
		"responseTime": 123.0,
		"requestPreview": map[string]interface{}{
			"method": "GET",
			"url":    "https://example.com/api",
		},
	}
	resp2 := map[string]interface{}{
		"status":       404,
		"statusText":   "Not Found",
		"responseTime": 50.0,
		"requestPreview": map[string]interface{}{
			"method": "POST",
			"url":    "https://example.com/api/missing",
		},
	}

	data1, _ := json.Marshal(resp1)
	data2, _ := json.Marshal(resp2)

	// Older response
	if err := os.WriteFile(filepath.Join(responsesDir, "response-20250101-120000.json"), data1, 0644); err != nil {
		t.Fatalf("failed to write response file 1: %v", err)
	}
	// Newer response
	if err := os.WriteFile(filepath.Join(responsesDir, "response-20250102-130000.json"), data2, 0644); err != nil {
		t.Fatalf("failed to write response file 2: %v", err)
	}

	// Load history from responses
	result := app.loadHistoryFromResponsesDir(responsesDir)

	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &items); err != nil {
		t.Fatalf("failed to parse history: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("expected 2 history items, got %d", len(items))
	}

	// Should be sorted newest first
	if items[0]["method"] != "POST" {
		t.Errorf("expected newest item first (POST), got %v", items[0]["method"])
	}
	if items[1]["method"] != "GET" {
		t.Errorf("expected oldest item second (GET), got %v", items[1]["method"])
	}
}

func TestLoadFileHistoryFromDir(t *testing.T) {
	app := NewApp()
	tmp := t.TempDir()

	// Create test.responses folder (simulating history for test.http)
	responsesDir := filepath.Join(tmp, "test.responses")
	if err := os.MkdirAll(responsesDir, 0755); err != nil {
		t.Fatalf("failed to create responses dir: %v", err)
	}

	resp := map[string]interface{}{
		"status":       200,
		"statusText":   "OK",
		"responseTime": 100.0,
		"requestPreview": map[string]interface{}{
			"method": "GET",
			"url":    "https://example.com",
		},
	}
	data, _ := json.Marshal(resp)
	if err := os.WriteFile(filepath.Join(responsesDir, "response-20250101-000000.json"), data, 0644); err != nil {
		t.Fatalf("failed to write response file: %v", err)
	}

	// Load using fileID that matches the folder name
	result := app.LoadFileHistoryFromDir("test", tmp)

	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &items); err != nil {
		t.Fatalf("failed to parse history: %v", err)
	}

	if len(items) != 1 {
		t.Fatalf("expected 1 history item, got %d", len(items))
	}
	if items[0]["method"] != "GET" {
		t.Errorf("expected method GET, got %v", items[0]["method"])
	}
}

func TestLoadFileHistoryFromRunLocation(t *testing.T) {
	app := NewApp()
	tmp := t.TempDir()
	oldwd, _ := os.Getwd()
	defer os.Chdir(oldwd)
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("failed to chdir to temp: %v", err)
	}

	fileID := "unsaved:tab-runloc"
	safe := app.sanitizeFileID(fileID)

	// Create {sanitizedFileID}.responses/ folder (same pattern as saved files)
	responsesDir := filepath.Join(tmp, safe+".responses")
	if err := os.MkdirAll(responsesDir, 0755); err != nil {
		t.Fatalf("failed to create responses dir: %v", err)
	}

	resp := map[string]interface{}{
		"status":       201,
		"statusText":   "Created",
		"responseTime": 200.0,
		"requestPreview": map[string]interface{}{
			"method": "POST",
			"url":    "https://example.com/create",
		},
	}
	data, _ := json.Marshal(resp)
	if err := os.WriteFile(filepath.Join(responsesDir, "response-20250101-000000.json"), data, 0644); err != nil {
		t.Fatalf("failed to write response file: %v", err)
	}

	result := app.LoadFileHistoryFromRunLocation(fileID)

	var items []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &items); err != nil {
		t.Fatalf("failed to parse history: %v", err)
	}

	if len(items) != 1 {
		t.Fatalf("expected 1 history item, got %d", len(items))
	}
	if items[0]["method"] != "POST" {
		t.Errorf("expected method POST, got %v", items[0]["method"])
	}
}

func TestSanitizeFileID(t *testing.T) {
	app := NewApp()
	got := app.sanitizeFileID("unsaved:tab 123")
	if got != "unsaved_tab-123" {
		t.Fatalf("sanitizeFileID()=%q want %q", got, "unsaved_tab-123")
	}

	got = app.sanitizeFileID("a/b\\c:d")
	if got != "a_b_c_d" {
		t.Fatalf("sanitizeFileID()=%q want %q", got, "a_b_c_d")
	}
}
