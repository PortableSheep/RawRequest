package httpclientlogic

import "testing"

func TestParseHeadersJSON(t *testing.T) {
	if got := ParseHeadersJSON(""); got != nil {
		t.Fatalf("expected nil")
	}
	if got := ParseHeadersJSON("   "); got != nil {
		t.Fatalf("expected nil")
	}
	if got := ParseHeadersJSON("not json"); got != nil {
		t.Fatalf("expected nil on invalid json")
	}
	got := ParseHeadersJSON("{\"A\":\"b\"}")
	if got["A"] != "b" {
		t.Fatalf("unexpected map: %#v", got)
	}
}

func TestIsFileUploadBody(t *testing.T) {
	if !IsFileUploadBody("Content-Type: multipart/form-data\n--boundary") {
		t.Fatalf("expected true")
	}
	if !IsFileUploadBody("hello < /tmp/file.txt") {
		t.Fatalf("expected true")
	}
	if IsFileUploadBody("regular body") {
		t.Fatalf("expected false")
	}
}

func TestExtractFileReferencePath(t *testing.T) {
	if _, ok := ExtractFileReferencePath("hello < /tmp/file.txt"); ok {
		t.Fatalf("expected false when not prefix")
	}

	path, ok := ExtractFileReferencePath("< /tmp/file.txt")
	if !ok || path != "/tmp/file.txt" {
		t.Fatalf("unexpected: %q %v", path, ok)
	}

	path, ok = ExtractFileReferencePath("   <   /tmp/file.txt   ")
	if !ok || path != "  /tmp/file.txt" {
		// Note: We intentionally preserve exact TrimPrefix behavior from production code.
		t.Fatalf("unexpected: %q %v", path, ok)
	}
}

func TestShouldSetDefaultContentType(t *testing.T) {
	if !ShouldSetDefaultContentType("", "{}") {
		t.Fatalf("expected true")
	}
	if ShouldSetDefaultContentType("application/json", "{}") {
		t.Fatalf("expected false")
	}
	if ShouldSetDefaultContentType("", "") {
		t.Fatalf("expected false")
	}
}

func TestIsLocalhostURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"http://localhost:3000/api", true},
		{"https://localhost/secure", true},
		{"http://127.0.0.1:8080/", true},
		{"https://127.0.0.1/test", true},
		{"http://[::1]:8080/api", true},
		{"https://[::1]/test", true},
		{"http://api.localhost:3000/", true},
		{"http://dev.localhost/test", true},
		{"http://example.com/api", false},
		{"https://google.com", false},
		{"http://192.168.1.1:8080/", false},
		{"http://myserver.local:3000/", false},
		{"not a url", false},
		{"", false},
	}
	for _, c := range cases {
		got := IsLocalhostURL(c.url)
		if got != c.want {
			t.Errorf("IsLocalhostURL(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}
