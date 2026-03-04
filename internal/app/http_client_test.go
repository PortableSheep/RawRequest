package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSendRequest_DefaultUserAgent(t *testing.T) {
	var seenUA string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	app := NewApp()
	_ = app.sendRequest("GET", srv.URL, "", "")

	seenUA = strings.TrimSpace(seenUA)
	if seenUA == "" {
		t.Fatalf("expected non-empty User-Agent")
	}

	base := "RawRequest"
	if strings.TrimSpace(Version) != "" {
		base = "RawRequest/" + strings.TrimSpace(Version)
	}
	expected := base + " (Wails; " + runtime.GOOS + "/" + runtime.GOARCH + ")"
	if seenUA != expected {
		t.Fatalf("expected User-Agent %q, got %q", expected, seenUA)
	}
}

func TestSendRequest_IncludesRequestAndResponseMetadata(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test", "ok")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("payload"))
	}))
	t.Cleanup(srv.Close)

	app := NewApp()
	got := app.sendRequest(http.MethodPost, srv.URL, "", `{"a":1}`)

	lines := strings.SplitN(got, "\n", 4)
	if len(lines) != 4 {
		t.Fatalf("unexpected response format: %q", got)
	}
	if lines[0] != "Status: 200 OK" {
		t.Fatalf("status line = %q", lines[0])
	}

	var requestMeta struct {
		Headers map[string]string `json:"headers"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[1], "Request: ")), &requestMeta); err != nil {
		t.Fatalf("request metadata parse error: %v", err)
	}
	if requestMeta.Headers["Content-Type"] != "application/json" {
		t.Fatalf("request headers = %#v", requestMeta.Headers)
	}

	var metadata struct {
		Timing struct {
			Total int64 `json:"total"`
		} `json:"timing"`
		Headers map[string]string `json:"headers"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[2], "Headers: ")), &metadata); err != nil {
		t.Fatalf("response metadata parse error: %v", err)
	}
	if metadata.Headers["x-test"] != "ok" {
		t.Fatalf("response headers = %#v", metadata.Headers)
	}
	if metadata.Timing.Total < 0 {
		t.Fatalf("timing total = %d", metadata.Timing.Total)
	}
	if lines[3] != "Body: payload" {
		t.Fatalf("body line = %q", lines[3])
	}
}

func TestSendRequestWithTimeout_ReturnsTimeoutError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	app := NewApp()
	got := app.sendRequestWithTimeout("req-1", http.MethodGet, srv.URL, "", "", 10)
	if got != "Error: Request timeout after 10ms" {
		t.Fatalf("unexpected timeout response: %q", got)
	}
}
