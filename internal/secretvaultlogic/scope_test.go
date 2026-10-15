package secretvaultlogic

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestFileScopedEnvRoundTrip(t *testing.T) {
	path := filepath.Join(string(filepath.Separator), "tmp", "a b", "api.http")
	bucket := FileScopedEnv(path, "dev")
	env, got, ok := ParseFileScopedEnv(bucket)
	if !ok || env != "dev" || got != path {
		t.Fatalf("round trip failed: bucket=%q env=%q path=%q ok=%v", bucket, env, got, ok)
	}
}

func TestFileScopedEnvEmptyPath(t *testing.T) {
	if got := FileScopedEnv("  ", "dev"); got != "" {
		t.Fatalf("expected empty bucket for empty path, got %q", got)
	}
}

func TestParseFileScopedEnvRejectsPlainEnv(t *testing.T) {
	if _, _, ok := ParseFileScopedEnv("dev"); ok {
		t.Fatal("plain env should not parse as file scope")
	}
	if _, _, ok := ParseFileScopedEnv("@file:dev:"); ok {
		t.Fatal("missing path should not parse")
	}
}

func TestSecretLookupChain(t *testing.T) {
	path := filepath.Join(string(filepath.Separator), "x", "api.http")
	got := SecretLookupChain(path, "dev")
	want := []string{FileScopedEnv(path, "dev"), FileScopedEnv(path, "default"), "dev", "default"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("chain = %v, want %v", got, want)
	}

	if got := SecretLookupChain("", ""); !reflect.DeepEqual(got, []string{"default"}) {
		t.Fatalf("no-file default chain = %v", got)
	}
	if got := SecretLookupChain(path, ""); len(got) != 2 {
		t.Fatalf("expected deduped chain of 2, got %v", got)
	}
}
