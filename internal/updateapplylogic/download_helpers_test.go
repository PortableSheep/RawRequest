package updateapplylogic

import (
	"testing"
	"time"
)

func TestTempArtifactPattern(t *testing.T) {
	if got := TempArtifactPattern("https://x/y.zip"); got != "rawrequest-update-artifact-*.zip" {
		t.Fatalf("zip pattern=%q", got)
	}
	if got := TempArtifactPattern("https://x/y.tgz"); got != "rawrequest-update-artifact-*.tgz" {
		t.Fatalf("tgz pattern=%q", got)
	}
	if got := TempArtifactPattern("https://x/y.tar.gz"); got != "rawrequest-update-artifact-*.tar.gz" {
		t.Fatalf("tar.gz pattern=%q", got)
	}
}

func TestBuildDownloadProgressPayload(t *testing.T) {
	p := BuildDownloadProgressPayload(5, 0)
	if p["written"].(int64) != 5 {
		t.Fatalf("written=%v", p["written"])
	}
	if _, ok := p["total"]; ok {
		t.Fatalf("expected no total when total<=0")
	}
	if _, ok := p["percent"]; ok {
		t.Fatalf("expected no percent when total<=0")
	}

	p2 := BuildDownloadProgressPayload(5, 10)
	if p2["total"].(int64) != 10 {
		t.Fatalf("total=%v", p2["total"])
	}
	if p2["percent"].(float64) != 0.5 {
		t.Fatalf("percent=%v", p2["percent"])
	}
}

func TestShouldEmitProgress(t *testing.T) {
	base := time.Date(2025, 12, 25, 0, 0, 0, 0, time.UTC)
	if !ShouldEmitProgress(base, base.Add(ProgressEmitInterval+time.Millisecond), 5, 10) {
		t.Fatal("expected emit after interval")
	}
	if ShouldEmitProgress(base, base.Add(ProgressEmitInterval), 5, 10) {
		t.Fatal("expected no emit at exactly interval")
	}
	if !ShouldEmitProgress(base, base, 10, 10) {
		t.Fatal("expected emit when completed")
	}
}
