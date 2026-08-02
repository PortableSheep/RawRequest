package app

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestServiceSaveBinaryResponseEndpoint_ByRequestID locks in the requestId
// contract: the app's previously stored binary body (from a prior HTTP round
// trip) is written verbatim to a service-generated temp file, never to a
// caller-supplied path.
func TestServiceSaveBinaryResponseEndpoint_ByRequestID(t *testing.T) {
	app := NewApp()
	app.storeBinaryBody("req-1", []byte{0x89, 0x50, 0x4e, 0x47})
	_, server := newTestServiceServer(t, app)

	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"requestId":   "req-1",
		"contentType": "image/png",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	got := mustDecodeJSON[map[string]string](t, resp)
	path := got["path"]
	if path == "" {
		t.Fatalf("result=%+v, want non-empty generated path", got)
	}
	t.Cleanup(func() { os.Remove(path) })

	if !strings.HasPrefix(filepath.Base(path), "rawrequest-save-") {
		t.Fatalf("path=%q, want a service-generated rawrequest-save-* temp file", path)
	}
	if !strings.HasSuffix(path, ".png") {
		t.Fatalf("path=%q, want .png extension derived from contentType", path)
	}
	if !isPathContainedIn(path, os.TempDir()) {
		t.Fatalf("path=%q, want it contained under the OS temp dir %q", path, os.TempDir())
	}
	assertFileMode0600(t, path)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "\x89PNG" {
		t.Fatalf("written body=%q, want PNG magic bytes", data)
	}
}

// TestServiceSaveBinaryResponseEndpoint_ByBase64 locks in the base64Body
// contract: the payload is decoded and written directly to a
// service-generated temp file.
func TestServiceSaveBinaryResponseEndpoint_ByBase64(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	payload := base64.StdEncoding.EncodeToString([]byte("hello-binary"))
	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"base64Body": payload,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200, body=%q", resp.StatusCode, readBody(t, resp))
	}
	got := mustDecodeJSON[map[string]string](t, resp)
	path := got["path"]
	if path == "" {
		t.Fatalf("result=%+v, want non-empty generated path", got)
	}
	t.Cleanup(func() { os.Remove(path) })

	if !isPathContainedIn(path, os.TempDir()) {
		t.Fatalf("path=%q, want it contained under the OS temp dir %q", path, os.TempDir())
	}
	assertFileMode0600(t, path)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "hello-binary" {
		t.Fatalf("written body=%q, want hello-binary", data)
	}
}

// TestServiceSaveBinaryResponseEndpoint_TempFallback locks in that, absent an
// explicit contentType, the handler still synthesizes a generated temp path
// and returns it (falling back to a generic extension).
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
	if !isPathContainedIn(got["path"], os.TempDir()) {
		t.Fatalf("path=%q, want under %q", got["path"], os.TempDir())
	}
	t.Cleanup(func() { os.Remove(got["path"]) })
}

// TestServiceSaveBinaryResponseEndpoint_RejectsExplicitDestPath is the
// regression test for the path-injection fix: a client-supplied destPath
// must be rejected with 400, and no file may be created at that sentinel
// location, proving the endpoint can no longer be used for arbitrary local
// file writes even though this service's CORS policy is '*'.
func TestServiceSaveBinaryResponseEndpoint_RejectsExplicitDestPath(t *testing.T) {
	app := NewApp()
	app.storeBinaryBody("req-1", []byte("payload"))
	_, server := newTestServiceServer(t, app)

	sentinel := filepath.Join(t.TempDir(), "should-not-be-created.bin")

	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"requestId": "req-1",
		"destPath":  sentinel,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400 for explicit destPath, body=%q", resp.StatusCode, readBody(t, resp))
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("sentinel path %q must not be created, stat err=%v", sentinel, err)
	}

	// Also verify destPath is rejected before the requestId/base64Body
	// requirement is even considered.
	resp = postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"destPath": sentinel,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400 for explicit destPath with no source", resp.StatusCode)
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("sentinel path %q must not be created, stat err=%v", sentinel, err)
	}
}

// TestServiceSaveBinaryResponseEndpoint_Errors locks in the error-mapping
// contract: missing source (400), unknown requestId (500), invalid base64
// (400).
func TestServiceSaveBinaryResponseEndpoint_Errors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing source status=%d, want 400", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"requestId": "does-not-exist",
	})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unknown requestId status=%d, want 500", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/save-binary-response", map[string]any{
		"base64Body": "not-valid-base64!!",
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

// isPathContainedIn reports whether path is dir itself or a descendant of it,
// after resolving symlinks (macOS's os.TempDir() is often a symlink, e.g.
// /var -> /private/var, which would otherwise make a plain prefix check
// fail even for correctly-contained paths).
func isPathContainedIn(path, dir string) bool {
	resolvedDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		resolvedDir = dir
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		resolvedPath = path
	}
	rel, err := filepath.Rel(resolvedDir, resolvedPath)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && rel != "")
}

// assertFileMode0600 fails the test unless path has exactly permission 0600,
// matching the os.CreateTemp contract this endpoint relies on.
func assertFileMode0600(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %q: %v", path, err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Fatalf("mode=%v, want 0600", perm)
	}
}
