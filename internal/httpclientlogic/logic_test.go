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
