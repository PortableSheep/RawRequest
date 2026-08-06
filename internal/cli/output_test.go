package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

// captureStdout redirects os.Stdout for the duration of fn and returns
// everything written to it. Used to characterize outputResults' printed
// shape without plumbing an io.Writer through the CLI's output path.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()

	orig := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	// Register cleanup immediately so both pipe ends are reliably closed
	// (and stdout restored) even if a later step in this function fails
	// or panics before reaching the end of the happy path.
	t.Cleanup(func() {
		os.Stdout = orig
		_ = w.Close()
		_ = r.Close()
	})
	os.Stdout = w

	fn()

	if err := w.Close(); err != nil {
		t.Fatalf("failed to close pipe writer: %v", err)
	}
	os.Stdout = orig

	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("failed to read captured stdout: %v", err)
	}
	return string(out)
}

// These tests lock in `rawrequest run -o json`'s conditional object-vs-array
// contract: a single result (one request, no expanded @depends chain)
// prints a single JSON object; multiple results (an expanded @depends chain
// and/or multiple -n names) print a JSON array, preserving the
// dependency-first, requested-request-last order RunSelected produces. This
// is the same contract MCP's run_request tool documents and implements
// against cli.RunSelected (see internal/mcp/server.go).
func TestOutputResults_JSON_SingleResultPrintsSingleObject(t *testing.T) {
	results := []ResponseResult{
		{RequestName: "solo", Method: "GET", URL: "http://example.com", Status: http.StatusOK, StatusText: "200 OK"},
	}

	out := captureStdout(t, func() {
		outputResults(results, OutputJSON)
	})

	trimmed := strings.TrimSpace(out)
	if !strings.HasPrefix(trimmed, "{") {
		t.Fatalf("expected a single JSON object for one result, got: %s", out)
	}

	var single ResponseResult
	if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
		t.Fatalf("expected valid single JSON object, got %s (%v)", out, err)
	}
	if single.RequestName != "solo" {
		t.Fatalf("unexpected result: %+v", single)
	}
}

func TestOutputResults_JSON_MultipleResultsPrintArrayInOrder(t *testing.T) {
	results := []ResponseResult{
		{RequestName: "login", Method: "GET", URL: "http://example.com/login", Status: http.StatusOK, StatusText: "200 OK"},
		{RequestName: "getUser", Method: "GET", URL: "http://example.com/user", Status: http.StatusOK, StatusText: "200 OK"},
	}

	out := captureStdout(t, func() {
		outputResults(results, OutputJSON)
	})

	trimmed := strings.TrimSpace(out)
	if !strings.HasPrefix(trimmed, "[") {
		t.Fatalf("expected a JSON array for a multi-step chain, got: %s", out)
	}

	var chain []ResponseResult
	if err := json.Unmarshal([]byte(trimmed), &chain); err != nil {
		t.Fatalf("expected valid JSON array, got %s (%v)", out, err)
	}
	if len(chain) != 2 {
		t.Fatalf("expected 2 chain results, got %d", len(chain))
	}
	// Dependencies first, requested request last: outputResults must
	// preserve the order RunSelected returns results in, not re-sort them.
	if chain[0].RequestName != "login" || chain[1].RequestName != "getUser" {
		t.Fatalf("expected [login, getUser] order (dependency first, requested request last), got %+v", chain)
	}
}
