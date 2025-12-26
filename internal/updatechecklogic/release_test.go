package updatechecklogic

import (
	"testing"
	"time"
)

func TestIsSkippableRelease(t *testing.T) {
	if !IsSkippableRelease(Release{Prerelease: true, TagName: "v1.0.0"}) {
		t.Fatal("expected prerelease to be skippable")
	}
	if !IsSkippableRelease(Release{Draft: true, TagName: "v1.0.0"}) {
		t.Fatal("expected draft to be skippable")
	}
	if !IsSkippableRelease(Release{TagName: ""}) {
		t.Fatal("expected empty tag to be skippable")
	}
	if IsSkippableRelease(Release{TagName: "v1.0.0"}) {
		t.Fatal("expected normal release to not be skippable")
	}
}

func TestDecideUpdate(t *testing.T) {
	rel := Release{
		TagName:     "v1.2.4",
		Name:        "Release 1.2.4",
		Body:        "Notes",
		HTMLURL:     "https://example.com/r",
		PublishedAt: time.Date(2025, 12, 25, 1, 2, 3, 0, time.UTC),
	}

	got := DecideUpdate("1.2.3", rel)
	if !got.Available {
		t.Fatal("expected Available=true")
	}
	if got.LatestVersion != "1.2.4" {
		t.Fatalf("LatestVersion=%q", got.LatestVersion)
	}
	if got.PublishedAt != "December 25, 2025" {
		t.Fatalf("PublishedAt=%q", got.PublishedAt)
	}

	notNewer := DecideUpdate("1.2.4", rel)
	if notNewer.Available {
		t.Fatal("expected Available=false when equal")
	}
}
