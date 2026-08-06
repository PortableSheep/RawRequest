package app

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// TestServiceImportCollectionEndpoint locks in the /v1/import-collection
// contract: a Postman collection JSON path is auto-detected and converted
// into ImportResult{Files: [{Name, Content}]} JSON.
func TestServiceImportCollectionEndpoint(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	dir := t.TempDir()
	collectionPath := filepath.Join(dir, "collection.json")
	collection := `{
  "info": {"name": "Demo"},
  "item": [
    {
      "name": "Ping",
      "request": {
        "method": "GET",
        "url": {"raw": "https://example.com/ping"}
      }
    }
  ]
}`
	if err := os.WriteFile(collectionPath, []byte(collection), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	resp := postJSONTo(t, server.URL, "/v1/import-collection", map[string]any{"path": collectionPath})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	result := mustDecodeJSON[struct {
		Files []struct {
			Name    string
			Content string
		}
	}](t, resp)
	if len(result.Files) != 1 {
		t.Fatalf("import-collection files=%+v, want exactly 1 file", result.Files)
	}
	if result.Files[0].Content == "" {
		t.Fatalf("import-collection file content is empty")
	}
}

// TestServiceImportCollectionEndpoint_Errors locks in the error contract:
// empty path is a 400 (validation), a nonexistent path is a 500 (I/O
// failure surfaced as-is).
func TestServiceImportCollectionEndpoint_Errors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/import-collection", map[string]any{"path": ""})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("empty path status=%d, want 500 (validation surfaced via app error)", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/import-collection", map[string]any{"path": "/does/not/exist.json"})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("missing path status=%d, want 500", resp.StatusCode)
	}
}

// TestServiceSaveResponseFileEndpoints locks in the two response-history
// save routes: save-response-file (next to an .http file) and
// save-response-file-to-run-location (app-managed directory keyed by file
// ID). Both return the written path as plain text.
func TestServiceSaveResponseFileEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	dir := t.TempDir()
	httpFilePath := filepath.Join(dir, "requests.http")

	resp := postJSONTo(t, server.URL, "/v1/save-response-file", map[string]any{
		"requestFilePath": httpFilePath,
		"responseJson":    `{"status":200}`,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save-response-file status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	savedPath := readBody(t, resp)
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatalf("saved response file missing: %v", err)
	}
	if filepath.Dir(savedPath) != filepath.Join(dir, "requests.responses") {
		t.Fatalf("saved path=%q, want inside requests.responses dir", savedPath)
	}

	// save-response-file-to-run-location writes under the app dir keyed by
	// fileID; redirect HOME so this test never touches the real user profile.
	home := t.TempDir()
	t.Setenv("HOME", home)

	resp = postJSONTo(t, server.URL, "/v1/save-response-file-to-run-location", map[string]any{
		"fileId":       "my-file",
		"responseJson": `{"status":201}`,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save-response-file-to-run-location status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	savedPath = readBody(t, resp)
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatalf("saved response file missing: %v", err)
	}
}

// TestServiceSaveResponseFileEndpoints_ValidationErrors locks in the 500
// contract for missing required identifiers (mapped through the app-layer
// validation errors, not a 400).
func TestServiceSaveResponseFileEndpoints_ValidationErrors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/save-response-file", map[string]any{"requestFilePath": "", "responseJson": "{}"})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/save-response-file-to-run-location", map[string]any{"fileId": "", "responseJson": "{}"})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", resp.StatusCode)
	}
}

// TestServiceLoadFileHistoryEndpoints locks in the load-file-history route
// family: both return "[]" as plain text when no response files exist, and
// a populated JSON array once one is written via the sibling save routes.
func TestServiceLoadFileHistoryEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	dir := t.TempDir()

	resp := postJSONTo(t, server.URL, "/v1/load-file-history-from-dir", map[string]any{"fileId": "requests", "dir": dir})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "[]" {
		t.Fatalf("body=%q, want [] for empty history", got)
	}

	responsesDir := filepath.Join(dir, "requests.responses")
	if err := os.MkdirAll(responsesDir, 0o755); err != nil {
		t.Fatalf("mkdir responses dir: %v", err)
	}
	respFile := filepath.Join(responsesDir, "response-20240101-120000.json")
	if err := os.WriteFile(respFile, []byte(`{"status":200,"statusText":"OK","processedUrl":"https://example.com"}`), 0o644); err != nil {
		t.Fatalf("write response fixture: %v", err)
	}

	resp = postJSONTo(t, server.URL, "/v1/load-file-history-from-dir", map[string]any{"fileId": "requests", "dir": dir})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	history := mustDecodeJSON[[]HistoryItem](t, resp)
	if len(history) != 1 || history[0].URL != "https://example.com" {
		t.Fatalf("history=%+v, want single item with URL set", history)
	}

	home := t.TempDir()
	t.Setenv("HOME", home)
	resp = postJSONTo(t, server.URL, "/v1/load-file-history-from-run-location", map[string]any{"fileId": "no-such-file"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "[]" {
		t.Fatalf("body=%q, want [] for missing run-location history", got)
	}
}

// TestServiceImportFileEndpoints_MethodAndDecodeErrors characterizes the
// shared method/error-handling contract for the import/file route family.
func TestServiceImportFileEndpoints_MethodAndDecodeErrors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	paths := []string{
		"/v1/import-collection",
		"/v1/save-response-file",
		"/v1/save-response-file-to-run-location",
		"/v1/load-file-history-from-dir",
		"/v1/load-file-history-from-run-location",
	}

	for _, path := range paths {
		t.Run(path+"/GET", func(t *testing.T) {
			resp := requestTo(t, http.MethodGet, server.URL, path, "")
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d, want 405", resp.StatusCode)
			}
		})
		t.Run(path+"/bad-json", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte("{bad"))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400", resp.StatusCode)
			}
		})
	}
}
