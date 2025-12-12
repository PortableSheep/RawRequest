package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Version is set at build time via ldflags
var Version = "1.0.0"

// GitHubRelease represents a release from the GitHub API
type GitHubRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
}

// UpdateInfo contains information about an available update
type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseNotes   string `json:"releaseNotes"`
	ReleaseName    string `json:"releaseName"`
	PublishedAt    string `json:"publishedAt"`
}

const (
	githubOwner = "portablesheep" // TODO: Update this to your GitHub username
	githubRepo  = "RawRequest"
)

// GetAppVersion returns the current application version
func (a *App) GetAppVersion() string {
	return Version
}

// CheckForUpdates checks GitHub releases for a newer version
func (a *App) CheckForUpdates() (UpdateInfo, error) {
	info := UpdateInfo{
		Available:      false,
		CurrentVersion: Version,
	}

	// Fetch latest release from GitHub
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", githubOwner, githubRepo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return info, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "RawRequest-UpdateChecker")

	resp, err := client.Do(req)
	if err != nil {
		return info, fmt.Errorf("failed to fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		// No releases yet
		return info, nil
	}

	if resp.StatusCode != 200 {
		return info, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return info, fmt.Errorf("failed to read response: %w", err)
	}

	var release GitHubRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return info, fmt.Errorf("failed to parse release: %w", err)
	}

	// Skip prereleases and drafts
	if release.Prerelease || release.Draft {
		return info, nil
	}

	// Parse versions and compare
	latestVersion := strings.TrimPrefix(release.TagName, "v")
	if isNewerVersion(latestVersion, Version) {
		info.Available = true
		info.LatestVersion = latestVersion
		info.ReleaseURL = release.HTMLURL
		info.ReleaseNotes = release.Body
		info.ReleaseName = release.Name
		info.PublishedAt = release.PublishedAt.Format("January 2, 2006")
	}

	return info, nil
}

// OpenReleaseURL opens the release URL in the default browser
func (a *App) OpenReleaseURL(url string) error {
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}

// isNewerVersion compares two semantic version strings
// Returns true if latest is newer than current
func isNewerVersion(latest, current string) bool {
	latestParts := parseVersion(latest)
	currentParts := parseVersion(current)

	for i := 0; i < 3; i++ {
		if latestParts[i] > currentParts[i] {
			return true
		}
		if latestParts[i] < currentParts[i] {
			return false
		}
	}
	return false
}

// parseVersion extracts major, minor, patch from a version string
func parseVersion(v string) [3]int {
	// Remove any leading 'v' and trailing metadata
	v = strings.TrimPrefix(v, "v")

	// Handle versions like "1.0.0-beta.1" by taking only the numeric part
	re := regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?`)
	matches := re.FindStringSubmatch(v)

	var parts [3]int
	if len(matches) > 1 && matches[1] != "" {
		parts[0], _ = strconv.Atoi(matches[1])
	}
	if len(matches) > 2 && matches[2] != "" {
		parts[1], _ = strconv.Atoi(matches[2])
	}
	if len(matches) > 3 && matches[3] != "" {
		parts[2], _ = strconv.Atoi(matches[3])
	}
	return parts
}
