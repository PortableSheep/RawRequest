package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExecuteRequests_PreScriptSetVarAffectsPlaceholders(t *testing.T) {
	app := NewApp()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("t"); got != "abc" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "bad t", "got": got})
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer srv.Close()

	requests := []map[string]interface{}{
		{
			"method":    "GET",
			"url":       srv.URL + "?t={{token}}",
			"headers":   map[string]string{},
			"body":      "",
			"preScript": "setVar('token','abc');",
		},
	}

	out := app.ExecuteRequests(requests)
	if out == "" {
		t.Fatalf("expected non-empty response")
	}
	if out[:7] != "Status:" {
		t.Fatalf("expected Status response, got: %q", out)
	}
}

func TestExecuteRequests_PreScriptCanSetHeader(t *testing.T) {
	app := NewApp()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Test"); got != "1" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "missing header", "got": got})
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer srv.Close()

	requests := []map[string]interface{}{
		{
			"method":    "GET",
			"url":       srv.URL,
			"headers":   map[string]string{},
			"body":      "",
			"preScript": "setHeader('X-Test','1');",
		},
	}

	out := app.ExecuteRequests(requests)
	if out == "" {
		t.Fatalf("expected non-empty response")
	}
	if out[:7] != "Status:" {
		t.Fatalf("expected Status response, got: %q", out)
	}
}

func TestExecuteRequests_ResponseVariablesAffectNextRequest(t *testing.T) {
	app := NewApp()

	var hitSecond bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/first":
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "xyz"})
		case "/second":
			hitSecond = true
			if got := r.URL.Query().Get("t"); got != "xyz" {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "bad t", "got": got})
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	requests := []map[string]interface{}{
		{
			"method":  "GET",
			"url":     srv.URL + "/first",
			"headers": map[string]string{},
			"body":    "",
		},
		{
			"method":  "GET",
			"url":     srv.URL + "/second?t={{token}}",
			"headers": map[string]string{},
			"body":    "",
		},
	}

	out := app.ExecuteRequests(requests)
	if out == "" {
		t.Fatalf("expected non-empty response")
	}
	if !hitSecond {
		t.Fatalf("expected second request to be executed")
	}
}
