package responseparse

import "testing"

func TestParse_StatusAndBody(t *testing.T) {
	res := Parse("Status: 200 OK\nHeaders: {}\nBody: hello")
	if res["status"].(int) != 200 {
		t.Fatalf("expected status 200")
	}
	if res["statusText"].(string) != "OK" {
		t.Fatalf("expected statusText OK")
	}
	if res["body"].(string) != "hello" {
		t.Fatalf("expected body hello")
	}
}

func TestParse_MultilineBody(t *testing.T) {
	res := Parse("Status: 200 OK\nBody: line1\nline2")
	if res["body"].(string) != "line1\nline2" {
		t.Fatalf("expected multiline body")
	}
}

func TestParse_BadHeadersStillHasHeadersMap(t *testing.T) {
	res := Parse("Status: 200 OK\nHeaders: not-json\nBody: hi")
	h, ok := res["headers"].(map[string]string)
	if !ok || h == nil {
		t.Fatalf("expected headers map")
	}
}
