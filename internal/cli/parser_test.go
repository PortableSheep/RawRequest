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
