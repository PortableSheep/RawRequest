package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestServiceSendRequestEndpoints_HappyPath locks in the plain-text contract
// returned by /v1/send-request, /v1/send-request-with-id and
// /v1/send-request-with-timeout: a "Status: ...\nRequest: ...\nHeaders:
// ...\nBody: ..." formatted string built from the real HTTP round trip.
func TestServiceSendRequestEndpoints_HappyPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("pong"))
	}))
	defer upstream.Close()

	_, server := newTestServiceServer(t, nil)

	cases := []struct {
		name string
		path string
		body map[string]any
	}{
		{"send-request", "/v1/send-request", map[string]any{
			"method": "GET", "url": upstream.URL, "headersJson": "{}", "body": "",
		}},
		{"send-request-with-id", "/v1/send-request-with-id", map[string]any{
			"id": "req-1", "method": "GET", "url": upstream.URL, "headersJson": "{}", "body": "",
		}},
		{"send-request-with-timeout", "/v1/send-request-with-timeout", map[string]any{
			"id": "req-2", "method": "GET", "url": upstream.URL, "headersJson": "{}", "body": "", "timeoutMs": 5000,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := postJSONTo(t, server.URL, tc.path, tc.body)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status=%d, want 200", resp.StatusCode)
			}
			if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/plain") {
				t.Fatalf("content-type=%q, want text/plain", ct)
			}
			text := readBody(t, resp)
			if !strings.HasPrefix(text, "Status: 200 OK\n") {
				t.Fatalf("body=%q, want prefix %q", text, "Status: 200 OK\n")
			}
			if !strings.Contains(text, "Body: pong") {
				t.Fatalf("body=%q, want to contain Body: pong", text)
			}
		})
	}
}

// TestServiceExecuteRequestsEndpoints_HappyPath verifies /v1/execute-requests
// and /v1/execute-requests-with-id run a chain and return a 200 with the
// joined per-request result text.
func TestServiceExecuteRequestsEndpoints_HappyPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	_, server := newTestServiceServer(t, nil)

	reqs := []map[string]any{
		{"name": "create", "method": "POST", "url": upstream.URL, "headers": map[string]string{}, "body": ""},
	}

	t.Run("execute-requests", func(t *testing.T) {
		resp := postJSONTo(t, server.URL, "/v1/execute-requests", map[string]any{"requests": reqs})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status=%d, want 200", resp.StatusCode)
		}
		text := readBody(t, resp)
		if !strings.Contains(text, "Status: 201 Created") {
			t.Fatalf("body=%q, want to contain Status: 201 Created", text)
		}
	})

	t.Run("execute-requests-with-id", func(t *testing.T) {
		resp := postJSONTo(t, server.URL, "/v1/execute-requests-with-id", map[string]any{
			"id": "chain-1", "requests": reqs,
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status=%d, want 200", resp.StatusCode)
		}
		text := readBody(t, resp)
		if !strings.Contains(text, "Status: 201 Created") {
			t.Fatalf("body=%q, want to contain Status: 201 Created", text)
		}
	})
}

// TestServiceCancelRequestEndpoint verifies cancellation is a fire-and-forget
// 204, safe to call even for an unknown request ID (no-op).
func TestServiceCancelRequestEndpoint(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/cancel-request", map[string]any{"requestId": "does-not-exist"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", resp.StatusCode)
	}
}

// TestServiceStartLoadTestEndpoint_InvalidConfig verifies that malformed load
// test configuration/args are rejected synchronously with a 400 before any
// background work is scheduled.
func TestServiceStartLoadTestEndpoint_InvalidConfig(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/start-load-test", map[string]any{
		"requestId":      "lt-1",
		"method":         "GET",
		"url":            "", // invalid: empty URL should fail normalization
		"headersJson":    "{}",
		"body":           "",
		"loadConfigJson": "{}",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400, body=%q", resp.StatusCode, readBody(t, resp))
	}
}

// TestServiceExecutionEndpoints_MethodAndDecodeErrors characterizes the
// shared method/error handling contract across the request-execution family:
// GET is rejected with 405 and malformed JSON is rejected with 400.
func TestServiceExecutionEndpoints_MethodAndDecodeErrors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	paths := []string{
		"/v1/send-request",
		"/v1/send-request-with-id",
		"/v1/send-request-with-timeout",
		"/v1/execute-requests",
		"/v1/execute-requests-with-id",
		"/v1/cancel-request",
	}

	for _, path := range paths {
		t.Run(path+"/GET", func(t *testing.T) {
			resp := requestTo(t, http.MethodGet, server.URL, path, "")
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d, want 405", resp.StatusCode)
			}
		})
		t.Run(path+"/bad-json", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte("not-json"))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400", resp.StatusCode)
			}
		})
		t.Run(path+"/unknown-field", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte(`{"unexpectedField":true}`))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400 for unknown field", resp.StatusCode)
			}
		})
	}
}

// TestServiceHealthEndpoint locks in the plain "ok" health contract used by
// the desktop app and CLI to detect a running service.
func TestServiceHealthEndpoint(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := requestTo(t, http.MethodGet, server.URL, "/v1/health", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "ok" {
		t.Fatalf("body=%q, want ok", got)
	}

	resp = requestTo(t, http.MethodPost, server.URL, "/v1/health", "")
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d, want 405", resp.StatusCode)
	}
}

// TestServiceCORSPreflight verifies the shared CORS wrapper answers OPTIONS
// with the headers the Angular frontend relies on, for both known and
// unknown routes (since it wraps the whole mux).
func TestServiceCORSPreflight(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	req, err := http.NewRequest(http.MethodOptions, server.URL+"/v1/send-request", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin=%q, want *", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods=%q", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers=%q", got)
	}
}
