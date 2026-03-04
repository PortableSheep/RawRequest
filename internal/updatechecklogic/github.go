package updatechecklogic

import (
	"fmt"
	"net/http"
)

func LatestReleaseAPIURL(owner, repo string) string {
	return fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)
}

func ListReleasesAPIURL(owner, repo string, perPage int) string {
	if perPage <= 0 {
		perPage = 10
	}
	return fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=%d", owner, repo, perPage)
}

func BuildLatestReleaseRequest(owner, repo, userAgent string) (*http.Request, error) {
	req, err := http.NewRequest("GET", LatestReleaseAPIURL(owner, repo), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}
	return req, nil
}

func BuildListReleasesRequest(owner, repo, userAgent string, perPage int) (*http.Request, error) {
	req, err := http.NewRequest("GET", ListReleasesAPIURL(owner, repo, perPage), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}
	return req, nil
}
