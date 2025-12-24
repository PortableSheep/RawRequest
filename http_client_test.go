package main

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
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
	_ = app.SendRequest("GET", srv.URL, "", "")

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
