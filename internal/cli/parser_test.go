package cli

import (
	"testing"
)

func TestParseHttpFile_Names(t *testing.T) {
	content := "@name getUser\nGET https://httpbun.com/get\n\n###\n\n@name postData\nPOST https://httpbun.com/post\nContent-Type: application/json\n\n{\"test\": \"data\"}"

	parsed := ParseHttpFile(content)

	if len(parsed.Requests) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(parsed.Requests))
	}

	t.Logf("Variables: %v", parsed.Variables)

	if parsed.Requests[0].Name != "getUser" {
		t.Errorf("request 0 name: expected 'getUser', got %q", parsed.Requests[0].Name)
	}
	if parsed.Requests[1].Name != "postData" {
		t.Errorf("request 1 name: expected 'postData', got %q", parsed.Requests[1].Name)
	}
}

func TestParseHttpFile_Mock(t *testing.T) {
	content := `@mock
@name getMockUser
GET /users/{{id}}
Content-Type: application/json

###

@name normalRequest
GET https://httpbun.com/get`

	parsed := ParseHttpFile(content)
	if len(parsed.Requests) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(parsed.Requests))
	}

	if !parsed.Requests[0].IsMock {
		t.Errorf("expected request 0 to be a mock")
	}
	if parsed.Requests[0].Name != "getMockUser" {
		t.Errorf("request 0 name: expected 'getMockUser', got %q", parsed.Requests[0].Name)
	}

	if parsed.Requests[1].IsMock {
		t.Errorf("expected request 1 to be normal (not a mock)")
	}
}

func TestParseHttpFile_ParsesTimeoutAndLoadConfig(t *testing.T) {
	content := `@name stress
@timeout 1500
@load duration=30s users=50 rps=200 failRate=0.05 adaptive=true
GET https://httpbun.com/get`

	parsed := ParseHttpFile(content)
	if len(parsed.Requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(parsed.Requests))
	}

	req := parsed.Requests[0]
	if req.Timeout != 1500 {
		t.Fatalf("expected timeout 1500ms, got %d", req.Timeout)
	}
	if got := req.LoadConfig["concurrent"]; got != 50 {
		t.Fatalf("expected concurrent=50, got %#v", got)
	}
	if got := req.LoadConfig["requestsPerSecond"]; got != 200 {
		t.Fatalf("expected requestsPerSecond=200, got %#v", got)
	}
	if got := req.LoadConfig["failureRateThreshold"]; got != "0.05" {
		t.Fatalf("expected failureRateThreshold=0.05, got %#v", got)
	}
	if got := req.LoadConfig["adaptive"]; got != true {
		t.Fatalf("expected adaptive=true, got %#v", got)
	}
}

func TestParseHttpFile_ParsesLoadBlockSyntax(t *testing.T) {
	content := `@name stress
@load
duration: 45s
users: 25
targetRPS: 150

GET https://httpbun.com/get`

	parsed := ParseHttpFile(content)
	if len(parsed.Requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(parsed.Requests))
	}

	req := parsed.Requests[0]
	if got := req.LoadConfig["duration"]; got != "45s" {
		t.Fatalf("expected duration=45s, got %#v", got)
	}
	if got := req.LoadConfig["concurrent"]; got != 25 {
		t.Fatalf("expected concurrent=25, got %#v", got)
	}
	if got := req.LoadConfig["requestsPerSecond"]; got != 150 {
		t.Fatalf("expected requestsPerSecond=150, got %#v", got)
	}
}
