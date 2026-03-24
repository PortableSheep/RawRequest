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

func TestParse_BinaryMetadata(t *testing.T) {
	input := `Status: 200 OK
Headers: {"headers":{"content-type":"application/pdf"},"timing":{"total":50},"size":1024,"isBinary":true,"contentType":"application/pdf"}
Body: dGVzdA==`

	res := Parse(input)
	if res["isBinary"] != true {
		t.Fatalf("expected isBinary=true, got %v", res["isBinary"])
	}
	if res["contentType"].(string) != "application/pdf" {
		t.Fatalf("expected contentType=application/pdf, got %v", res["contentType"])
	}
	if res["size"].(int64) != 1024 {
		t.Fatalf("expected size=1024, got %v", res["size"])
	}
	if res["body"].(string) != "dGVzdA==" {
		t.Fatalf("expected base64 body, got %v", res["body"])
	}
}

func TestParse_NonBinaryOmitsFlag(t *testing.T) {
	input := `Status: 200 OK
Headers: {"headers":{"content-type":"application/json"},"timing":{"total":10},"size":42}
Body: {"key":"value"}`

	res := Parse(input)
	if _, exists := res["isBinary"]; exists {
		t.Fatalf("expected isBinary to be absent for text response")
	}
}
