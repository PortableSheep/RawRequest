package app

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestServiceSaveBinaryResponseEndpoint_ByRequestID locks in the
// requestId+destPath contract: the app's previously stored binary body
// (from a prior HTTP round trip) is written verbatim to destPath.
func TestServiceSaveBinaryResponseEndpoint_ByRequestID(t *testing.T) {
	app := NewApp()
	app.storeBinaryBody("req-1", []byte{0x89, 0x50, 0x4e, 0x47})
	_, server := newTestServiceServer(t, app)

	destPath := filepath.Join(t.TempDir(), "out.png")
	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"requestId": "req-1",
		"destPath":  destPath,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	got := mustDecodeJSON[map[string]string](t, resp)
	if got["path"] != destPath {
		t.Fatalf("result=%+v, want path=%s", got, destPath)
	}
	data, err := os.ReadFile(destPath)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "\x89PNG" {
		t.Fatalf("written body=%q, want PNG magic bytes", data)
	}
}

// TestServiceSaveBinaryResponseEndpoint_ByBase64 locks in the
// base64Body+destPath contract, decoding and writing the payload directly.
func TestServiceSaveBinaryResponseEndpoint_ByBase64(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	destPath := filepath.Join(t.TempDir(), "out.bin")
	payload := base64.StdEncoding.EncodeToString([]byte("hello-binary"))

	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"base64Body": payload,
		"destPath":   destPath,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	data, err := os.ReadFile(destPath)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "hello-binary" {
		t.Fatalf("written body=%q, want hello-binary", data)
	}
}

// TestServiceSaveBinaryResponseEndpoint_TempFallback locks in the
// no-destPath contract: the handler synthesizes a temp path from the
// requestUrl/contentType and returns it.
func TestServiceSaveBinaryResponseEndpoint_TempFallback(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	payload := base64.StdEncoding.EncodeToString([]byte("csv,data"))
	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"base64Body":  payload,
		"contentType": "text/csv",
		"requestUrl":  "https://example.com/export",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	got := mustDecodeJSON[map[string]string](t, resp)
	if got["path"] == "" {
		t.Fatalf("result=%+v, want non-empty temp path", got)
	}
	if !strings.HasPrefix(got["path"], os.TempDir()) {
		t.Fatalf("path=%q, want under %q", got["path"], os.TempDir())
	}
	t.Cleanup(func() { os.Remove(got["path"]) })
}

// TestServiceSaveBinaryResponseEndpoint_Errors locks in the error-mapping
// contract: missing source (400), unknown requestId (500), invalid base64 (400).
func TestServiceSaveBinaryResponseEndpoint_Errors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	destPath := filepath.Join(t.TempDir(), "out.bin")

	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{"destPath": destPath})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing source status=%d, want 400", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"requestId": "does-not-exist", "destPath": destPath,
	})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unknown requestId status=%d, want 500", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"base64Body": "not-valid-base64!!", "destPath": destPath,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid base64 status=%d, want 400", resp.StatusCode)
	}
}

// TestServiceSaveBinaryResponseEndpoint_MethodAndDecodeErrors characterizes
// the shared method/error-handling contract for the binary-save route.
func TestServiceSaveBinaryResponseEndpoint_MethodAndDecodeErrors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := requestTo(t, http.MethodGet, server.URL, "/v1/save-binary-response", "")
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d, want 405", resp.StatusCode)
	}

	resp = postRawTo(t, server.URL, "/v1/save-binary-response", []byte("{not json"))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", resp.StatusCode)
	}
}
