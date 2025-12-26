package loadtest

import "testing"

func TestParseDurationMsGo(t *testing.T) {
	if got := parseDurationMsGo(""); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
	if got := parseDurationMsGo("30s"); got != 30000 {
		t.Fatalf("expected 30000, got %d", got)
	}
	if got := parseDurationMsGo("1.5s"); got != 1500 {
		t.Fatalf("expected 1500, got %d", got)
	}
	if got := parseDurationMsGo("100"); got != 100 {
		t.Fatalf("expected 100, got %d", got)
	}
	if got := parseDurationMsGo("-1"); got != 0 {
		t.Fatalf("expected 0 for negative, got %d", got)
	}
}

func TestParseFailureRateThresholdGo(t *testing.T) {
	if v, ok := parseFailureRateThresholdGo(nil); ok || v != 0 {
		t.Fatalf("expected (0,false), got (%v,%v)", v, ok)
	}
	if v, ok := parseFailureRateThresholdGo(0.01); !ok || v != 0.01 {
		t.Fatalf("expected (0.01,true), got (%v,%v)", v, ok)
	}
	if v, ok := parseFailureRateThresholdGo(5.0); !ok || v != 0.05 {
		t.Fatalf("expected (0.05,true) for 5.0, got (%v,%v)", v, ok)
	}
	if v, ok := parseFailureRateThresholdGo("5%"); !ok || v != 0.05 {
		t.Fatalf("expected (0.05,true) for 5%%, got (%v,%v)", v, ok)
	}
	if v, ok := parseFailureRateThresholdGo("200%"); !ok || v != 1 {
		t.Fatalf("expected clamp to 1, got (%v,%v)", v, ok)
	}
}

func TestNormalizeLoadTestConfigGo_Defaults(t *testing.T) {
	cfg := Config{}
	norm, err := NormalizeConfig(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !norm.HasIterations || norm.Iterations != 10 {
		t.Fatalf("expected default iterations=10, got HasIterations=%v Iterations=%d", norm.HasIterations, norm.Iterations)
	}
	if norm.StartUsers != 1 || norm.MaxUsers != 1 {
		t.Fatalf("expected StartUsers=1 MaxUsers=1, got %d %d", norm.StartUsers, norm.MaxUsers)
	}
}

func TestNormalizeLoadTestConfigGo_ClampsStartUsers(t *testing.T) {
	start := 10
	max := 3
	cfg := Config{StartUsers: &start, MaxUsers: &max}
	norm, err := NormalizeConfig(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if norm.StartUsers != 3 || norm.MaxUsers != 3 {
		t.Fatalf("expected StartUsers clamped to MaxUsers=3, got %d %d", norm.StartUsers, norm.MaxUsers)
	}
}

func TestNormalizeLoadTestConfigGo_AdaptiveDefaults(t *testing.T) {
	cfg := Config{Adaptive: true}
	norm, err := NormalizeConfig(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !norm.AdaptiveEnabled {
		t.Fatalf("expected AdaptiveEnabled true")
	}
	if norm.AdaptiveFailureRate != 0.01 {
		t.Fatalf("expected default AdaptiveFailureRate=0.01, got %v", norm.AdaptiveFailureRate)
	}
	if norm.AdaptiveWindowSec != 15 || norm.AdaptiveStableSec != 20 {
		t.Fatalf("expected window/stable defaults 15/20, got %d/%d", norm.AdaptiveWindowSec, norm.AdaptiveStableSec)
	}
}
