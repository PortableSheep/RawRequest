package updatechecklogic

import (
	"encoding/json"
	"strings"
	"time"
)

// Release represents the subset of the GitHub Release payload we care about.
type Release struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
}

func ParseLatestReleaseJSON(body []byte) (Release, error) {
	var rel Release
	err := json.Unmarshal(body, &rel)
	return rel, err
}

func IsSkippableRelease(rel Release) bool {
	return rel.Prerelease || rel.Draft || strings.TrimSpace(rel.TagName) == ""
}

type UpdateDecision struct {
	Available     bool
	LatestVersion string
	ReleaseURL    string
	ReleaseNotes  string
	ReleaseName   string
	PublishedAt   string
}

// DecideUpdate computes the update fields given the current version and a GitHub release.
// It preserves existing behavior: compare numeric major/minor/patch only and format
// PublishedAt with "January 2, 2006".
func DecideUpdate(currentVersion string, rel Release) UpdateDecision {
	decision := UpdateDecision{Available: false}
	if IsSkippableRelease(rel) {
		return decision
	}

	latestVersion := strings.TrimPrefix(rel.TagName, "v")
	if IsNewerVersion(latestVersion, currentVersion) {
		decision.Available = true
		decision.LatestVersion = latestVersion
		decision.ReleaseURL = rel.HTMLURL
		decision.ReleaseNotes = rel.Body
		decision.ReleaseName = rel.Name
		decision.PublishedAt = rel.PublishedAt.Format("January 2, 2006")
	}
	return decision
}
