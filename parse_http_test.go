package main

import "testing"

func TestParseHttp_BraceScripts(t *testing.T) {
	app := NewApp()

	content := "" +
		"###\n" +
		"GET https://example.com\n" +
		"< {\n" +
		"  console.log('pre');\n" +
		"}\n" +
		">\n" +
		"{\n" +
		"  console.log('post');\n" +
		"}\n"

	requests := app.ParseHttp(content, map[string]string{}, map[string]string{})
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}

	r := requests[0]
	pre, _ := r["preScript"].(string)
	post, _ := r["postScript"].(string)

	if pre == "" {
		t.Fatalf("expected preScript to be set")
	}
	if post == "" {
		t.Fatalf("expected postScript to be set")
	}
	if r["method"] != "GET" {
		t.Fatalf("expected method GET, got %v", r["method"])
	}
	if r["url"] != "https://example.com" {
		t.Fatalf("expected url https://example.com, got %v", r["url"])
	}
}
