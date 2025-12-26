package secretvaultlogic

import "testing"

func TestNormalizeEnv_DefaultsToDefault(t *testing.T) {
	if got := NormalizeEnv(" "); got != "default" {
		t.Fatalf("expected default, got %q", got)
	}
	if got := NormalizeEnv("dev"); got != "dev" {
		t.Fatalf("expected dev, got %q", got)
	}
}

func TestNormalizeKey_TrimsAndValidates(t *testing.T) {
	got, err := NormalizeKey("  token  ")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if got != "token" {
		t.Fatalf("expected trimmed key")
	}

	_, err = NormalizeKey("  ")
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestSnapshotSecretKeys_SortsKeys(t *testing.T) {
	in := map[string]map[string]string{
		"dev": {"b": "1", "a": "2"},
	}
	out := SnapshotSecretKeys(in)
	if len(out["dev"]) != 2 || out["dev"][0] != "a" || out["dev"][1] != "b" {
		t.Fatalf("expected sorted keys, got %#v", out["dev"])
	}
}
