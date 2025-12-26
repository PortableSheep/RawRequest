package historylogic

import "testing"

func TestSanitizeFileID(t *testing.T) {
	got := SanitizeFileID("unsaved:tab 123")
	if got != "unsaved_tab-123" {
		t.Fatalf("unexpected: %q", got)
	}

	got = SanitizeFileID("a/b\\c:d")
	if got != "a_b_c_d" {
		t.Fatalf("unexpected: %q", got)
	}
}
