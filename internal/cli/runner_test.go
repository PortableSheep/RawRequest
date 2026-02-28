package cli

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExecuteRequest_SetsDefaultsAndReturnsResponse(t *testing.T) {
	var seenUA, seenContentType string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUA = r.Header.Get("User-Agent")
		seenContentType = r.Header.Get("Content-Type")
		w.Header().Set("X-Test", "ok")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("done"))
	}))
	t.Cleanup(srv.Close)

	runner := NewRunner(&Options{
		Variables: make(map[string]string),
		Timeout:   0,
	}, "test-version")
	result := runner.ExecuteRequest(Request{
		Name:   "req",
		Method: http.MethodPost,
		URL:    srv.URL,
		Body:   `{"a":1}`,
	})

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if result.Status != http.StatusAccepted {
		t.Fatalf("status = %d", result.Status)
	}
	if result.StatusText != "202 Accepted" {
		t.Fatalf("status text = %q", result.StatusText)
	}
	if result.Body != "done" {
		t.Fatalf("body = %q", result.Body)
	}
	if result.Headers["x-test"] != "ok" {
		t.Fatalf("headers = %#v", result.Headers)
	}
	if seenUA != "RawRequest/test-version" {
		t.Fatalf("user-agent = %q", seenUA)
	}
	if seenContentType != "application/json" {
		t.Fatalf("content-type = %q", seenContentType)
	}
	if result.Timing.Total < 0 {
		t.Fatalf("timing = %#v", result.Timing)
	}
}

func TestExecuteRequest_TimeoutError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(1500 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	runner := NewRunner(&Options{
		Variables: make(map[string]string),
		Timeout:   1,
	}, "test-version")
	result := runner.ExecuteRequest(Request{
		Method: http.MethodGet,
		URL:    srv.URL,
	})

	if !strings.HasPrefix(result.Error, "Request failed: ") {
		t.Fatalf("error = %q", result.Error)
	}
}

func TestExecuteRequest_PreScriptSetsVariable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Token") != "from-script" {
			t.Errorf("expected X-Token header 'from-script', got %q", r.Header.Get("X-Token"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	runner := NewRunner(&Options{
		Variables: make(map[string]string),
	}, "test")
	result := runner.ExecuteRequest(Request{
		Name:   "test",
		Method: http.MethodGet,
		URL:    srv.URL,
		Headers: map[string]string{
			"X-Token": "{{token}}",
		},
		PreScript: `< {
  setVar('token', 'from-script');
  setHeader('X-Token', 'from-script');
  console.log('pre-script ran');
}`,
	})

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if len(result.ScriptLogs) == 0 {
		t.Fatal("expected script logs from pre-script")
	}
	if result.ScriptLogs[0].Message != "pre-script ran" {
		t.Errorf("expected log message 'pre-script ran', got %q", result.ScriptLogs[0].Message)
	}
	if result.ScriptLogs[0].Source != "pre:test" {
		t.Errorf("expected log source 'pre:test', got %q", result.ScriptLogs[0].Source)
	}
	// Verify setVar persisted
	if runner.GetVariables()["token"] != "from-script" {
		t.Errorf("expected variable 'token'='from-script', got %q", runner.GetVariables()["token"])
	}
}

func TestExecuteRequest_PostScriptAccessesResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"token":"abc123"}`))
	}))
	t.Cleanup(srv.Close)

	runner := NewRunner(&Options{
		Variables: make(map[string]string),
	}, "test")
	result := runner.ExecuteRequest(Request{
		Name:   "login",
		Method: http.MethodGet,
		URL:    srv.URL,
		PostScript: `> {
  console.log('status: ' + response.status);
  setVar('authToken', response.json.token);
}`,
	})

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if len(result.ScriptLogs) == 0 {
		t.Fatal("expected script logs from post-script")
	}
	if result.ScriptLogs[0].Message != "status: 200" {
		t.Errorf("expected 'status: 200', got %q", result.ScriptLogs[0].Message)
	}
	if runner.GetVariables()["authToken"] != "abc123" {
		t.Errorf("expected authToken='abc123', got %q", runner.GetVariables()["authToken"])
	}
}

func TestExecuteRequest_NoScriptsFlag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	runner := NewRunner(&Options{
		Variables: make(map[string]string),
		NoScripts: true,
	}, "test")
	result := runner.ExecuteRequest(Request{
		Name:   "test",
		Method: http.MethodGet,
		URL:    srv.URL,
		PreScript: `< {
  console.log('should not appear');
}`,
		PostScript: `> {
  console.log('should not appear');
}`,
	})

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if len(result.ScriptLogs) != 0 {
		t.Errorf("expected no script logs with noScripts=true, got %d", len(result.ScriptLogs))
	}
}

func TestExecuteRequest_LogCallbackInvoked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	var callbackLogs []string
	runner := NewRunner(&Options{
		Variables: make(map[string]string),
	}, "test")
	runner.SetLogCallback(func(level, source, message string) {
		callbackLogs = append(callbackLogs, message)
	})

	result := runner.ExecuteRequest(Request{
		Name:   "test",
		Method: http.MethodGet,
		URL:    srv.URL,
		PostScript: `> {
  console.log('hello from callback');
  console.warn('warning msg');
}`,
	})

	if result.Error != "" {
		t.Fatalf("unexpected error: %s", result.Error)
	}
	if len(callbackLogs) != 2 {
		t.Fatalf("expected 2 callback invocations, got %d", len(callbackLogs))
	}
	if callbackLogs[0] != "hello from callback" {
		t.Errorf("expected 'hello from callback', got %q", callbackLogs[0])
	}
	// Also verify they appear in the result
	if len(result.ScriptLogs) != 2 {
		t.Fatalf("expected 2 script log entries, got %d", len(result.ScriptLogs))
	}
	if result.ScriptLogs[1].Level != "warn" {
		t.Errorf("expected level 'warn', got %q", result.ScriptLogs[1].Level)
	}
}

func TestCleanScript(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"pre-script block", "< {\n  console.log('hi');\n}", "  console.log('hi');"},
		{"post-script block", "> {\n  setVar('a', '1');\n}", "  setVar('a', '1');"},
		{"empty script", "< {\n}", ""},
		{"no markers", "console.log('raw');", "console.log('raw');"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := cleanScript(tt.input)
			if got != tt.expected {
				t.Errorf("cleanScript(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
