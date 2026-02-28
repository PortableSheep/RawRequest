package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestServiceEventsEndpointStreamsPublishedEvents(t *testing.T) {
	svc := &httpService{app: NewApp()}
	mux := http.NewServeMux()
	svc.registerRoutes(mux)
	server := httptest.NewServer(withServiceCORS(mux))
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/events", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open events stream: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Fatalf("content-type=%q, want text/event-stream", got)
	}

	received := make(chan appEvent, 1)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var evt appEvent
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &evt); err == nil {
				received <- evt
				return
			}
		}
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		svc.app.emitEvent("loadtest:progress", map[string]any{"requestId": "rid"})
		select {
		case evt := <-received:
			if evt.Event != "loadtest:progress" {
				t.Fatalf("event=%q, want loadtest:progress", evt.Event)
			}
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("payload type=%T", evt.Payload)
			}
			if got := payload["requestId"]; got != "rid" {
				t.Fatalf("requestId=%v, want rid", got)
			}
			return
		case <-time.After(25 * time.Millisecond):
			if time.Now().After(deadline) {
				t.Fatal("timed out waiting for SSE event")
			}
		}
	}
}

func TestServiceScriptLogEndpoints(t *testing.T) {
	svc := &httpService{app: NewApp()}
	mux := http.NewServeMux()
	svc.registerRoutes(mux)
	server := httptest.NewServer(withServiceCORS(mux))
	defer server.Close()

	postJSON := func(path string, payload any) *http.Response {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		resp, err := http.Post(server.URL+path, "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("post %s: %v", path, err)
		}
		return resp
	}

	resp := postJSON("/v1/record-script-log", map[string]any{
		"level":   "info",
		"source":  "test",
		"message": "hello",
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("record status=%d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	resp.Body.Close()

	resp = postJSON("/v1/get-script-logs", map[string]any{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get logs status=%d, want %d", resp.StatusCode, http.StatusOK)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var logs []ScriptLogEntry
	if err := json.Unmarshal(data, &logs); err != nil {
		t.Fatalf("unmarshal logs: %v (body=%s)", err, data)
	}
	if len(logs) != 1 || logs[0].Message != "hello" {
		t.Fatalf("logs=%+v, want single hello log", logs)
	}

	resp = postJSON("/v1/clear-script-logs", map[string]any{})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("clear status=%d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	resp.Body.Close()

	resp = postJSON("/v1/get-script-logs", map[string]any{})
	data, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if err := json.Unmarshal(data, &logs); err != nil {
		t.Fatalf("unmarshal logs after clear: %v (body=%s)", err, data)
	}
	if len(logs) != 0 {
		t.Fatalf("logs after clear=%d, want 0", len(logs))
	}
}
