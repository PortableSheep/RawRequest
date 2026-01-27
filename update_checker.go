package main

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"rawrequest/internal/updatechecklogic"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var Version = "1.0.0"

type GitHubRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Draft       bool      `json:"draft"`
}

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
	githubOwner = "portablesheep"
	githubRepo  = "RawRequest"
)

func (a *App) GetAppVersion() string {
	return Version
}

func (a *App) CheckForUpdates() (UpdateInfo, error) {
	info := UpdateInfo{
		Available:      false,
		CurrentVersion: Version,
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := updatechecklogic.BuildLatestReleaseRequest(githubOwner, githubRepo, "RawRequest-UpdateChecker")
	if err != nil {
		return info, fmt.Errorf("failed to create request: %w", err)
	}

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

	rel, err := updatechecklogic.ParseLatestReleaseJSON(body)
	if err != nil {
		return info, fmt.Errorf("failed to parse release: %w", err)
	}

	decision := updatechecklogic.DecideUpdate(Version, rel)
	if decision.Available {
		info.Available = true
		info.LatestVersion = decision.LatestVersion
		info.ReleaseURL = decision.ReleaseURL
		info.ReleaseNotes = decision.ReleaseNotes
		info.ReleaseName = decision.ReleaseName
		info.PublishedAt = decision.PublishedAt
	}

	return info, nil
}

func (a *App) OpenReleaseURL(url string) error {
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}
