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

func TestParseReleasesJSON(t *testing.T) {
	body := []byte(`[
		{"tag_name":"v1.2.0","name":"Release 1.2.0","prerelease":false,"draft":false},
		{"tag_name":"v1.1.0","name":"Release 1.1.0","prerelease":false,"draft":false}
	]`)
	releases, err := ParseReleasesJSON(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(releases) != 2 {
		t.Fatalf("expected 2 releases, got %d", len(releases))
	}
	if releases[0].TagName != "v1.2.0" {
		t.Fatalf("releases[0].TagName=%q", releases[0].TagName)
	}
}

func TestParseReleasesJSON_InvalidJSON(t *testing.T) {
	_, err := ParseReleasesJSON([]byte(`not json`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestFilterStableReleases(t *testing.T) {
	releases := []Release{
		{TagName: "v1.3.0"},
		{TagName: "v1.3.0-beta.1", Prerelease: true},
		{TagName: "v1.2.0"},
		{TagName: "", Draft: true},
		{TagName: "v1.1.0"},
	}
	stable := FilterStableReleases(releases)
	if len(stable) != 3 {
		t.Fatalf("expected 3 stable releases, got %d", len(stable))
	}
	if stable[0].TagName != "v1.3.0" {
		t.Fatalf("stable[0].TagName=%q", stable[0].TagName)
	}
	if stable[1].TagName != "v1.2.0" {
		t.Fatalf("stable[1].TagName=%q", stable[1].TagName)
	}
	if stable[2].TagName != "v1.1.0" {
		t.Fatalf("stable[2].TagName=%q", stable[2].TagName)
	}
}

func TestFilterStableReleases_AllUnstable(t *testing.T) {
	releases := []Release{
		{TagName: "v1.0.0-rc1", Prerelease: true},
		{TagName: "", Draft: true},
	}
	stable := FilterStableReleases(releases)
	if len(stable) != 0 {
		t.Fatalf("expected 0 stable releases, got %d", len(stable))
	}
}
