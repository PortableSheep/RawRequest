package cli

import "testing"

func TestBuildLoadConfig_UsesRequestConfigAndCliOverrides(t *testing.T) {
	req := Request{
		LoadConfig: map[string]any{
			"concurrent":        25,
			"duration":          "45s",
			"requestsPerSecond": 150,
		},
	}
	opts := &Options{
		LoadUsers:       100,
		LoadUsersSet:    true,
		LoadFailRate:    0.05,
		LoadFailRateSet: true,
	}

	cfg := buildLoadConfig(req, opts)

	if got := cfg["concurrent"]; got != 100 {
		t.Fatalf("expected CLI users override, got %#v", got)
	}
	if got := cfg["duration"]; got != "45s" {
		t.Fatalf("expected request duration to remain, got %#v", got)
	}
	if got := cfg["requestsPerSecond"]; got != 150 {
		t.Fatalf("expected request RPS to remain, got %#v", got)
	}
	if got := cfg["failureRateThreshold"]; got != 0.05 {
		t.Fatalf("expected failure threshold override, got %#v", got)
	}
}

func TestBuildLoadConfig_AppliesDefaultsWhenFileHasNoConfig(t *testing.T) {
	cfg := buildLoadConfig(Request{}, &Options{})

	if got := cfg["concurrent"]; got != 10 {
		t.Fatalf("expected default concurrent=10, got %#v", got)
	}
	if got := cfg["duration"]; got != "30s" {
		t.Fatalf("expected default duration=30s, got %#v", got)
	}
}
