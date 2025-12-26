package loadtestbridge

import "testing"

func TestNormalizeStartArgs_TrimsAndValidates(t *testing.T) {
	rid, method, url, err := NormalizeStartArgs("  abc  ", "  GET  ", "  https://example.com  ")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if rid != "abc" {
		t.Fatalf("expected requestId trimmed")
	}
	if method != "GET" {
		t.Fatalf("expected method trimmed")
	}
	if url != "https://example.com" {
		t.Fatalf("expected url trimmed")
	}
}

func TestNormalizeStartArgs_MissingFields(t *testing.T) {
	_, _, _, err := NormalizeStartArgs(" ", "GET", "https://example.com")
	if err == nil {
		t.Fatalf("expected error for missing requestId")
	}

	_, _, _, err = NormalizeStartArgs("abc", " ", "https://example.com")
	if err == nil {
		t.Fatalf("expected error for missing method")
	}

	_, _, _, err = NormalizeStartArgs("abc", "GET", " ")
	if err == nil {
		t.Fatalf("expected error for missing url")
	}
}

func TestParseAndNormalizeConfig_InvalidJSON(t *testing.T) {
	_, err := ParseAndNormalizeConfig("not-json")
	if err == nil {
		t.Fatalf("expected error")
	}
}
