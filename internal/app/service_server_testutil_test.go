package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServiceServer wires up a fresh httpService/mux/httptest.Server triple
// for exercising the transport layer end-to-end. If app is nil, a bare
// NewApp() is used. The server is closed automatically via t.Cleanup.
func newTestServiceServer(t *testing.T, app *App) (*httpService, *httptest.Server) {
	t.Helper()
	if app == nil {
		app = NewApp()
	}
	svc := &httpService{app: app}
	mux := http.NewServeMux()
	svc.registerRoutes(mux)
	server := httptest.NewServer(withServiceCORS(mux))
	t.Cleanup(server.Close)
	return svc, server
}

// postJSONTo POSTs the given payload (marshalled to JSON) to baseURL+path.
func postJSONTo(t *testing.T, baseURL, path string, payload any) *http.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload for %s: %v", path, err)
	}
	return postRawTo(t, baseURL, path, body)
}

// postRawTo POSTs raw bytes (as application/json) to baseURL+path.
func postRawTo(t *testing.T, baseURL, path string, body []byte) *http.Response {
	t.Helper()
	resp, err := http.Post(baseURL+path, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("post %s: %v", path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// requestTo issues a request with the given method to baseURL+path.
func requestTo(t *testing.T, method, baseURL, path, body string) *http.Response {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		t.Fatalf("new request %s %s: %v", method, path, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request %s %s: %v", method, path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// mustDecodeJSON reads and JSON-decodes the response body into T, failing
// the test on any error.
func mustDecodeJSON[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	var out T
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return out
}

// readBody reads the full response body as a string, failing the test on error.
func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		t.Fatalf("read response body: %v", err)
	}
	return buf.String()
}

// newAppWithTestVault returns an App whose secret vault is pre-seeded with a
// temp-dir-backed SecretVault that has OS keyring interaction disabled, so
// secret-management tests never touch the host keychain.
func newAppWithTestVault(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	vault, err := NewSecretVault(t.TempDir())
	if err != nil {
		t.Fatalf("NewSecretVault: %v", err)
	}
	vault.keyringService = ""
	vault.keyringUser = ""
	app.secretVault = vault
	app.secretVaultOnce.Do(func() {})
	return app
}
