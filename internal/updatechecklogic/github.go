package updatechecklogic

import (
	"fmt"
	"net/http"
)

func LatestReleaseAPIURL(owner, repo string) string {
	return fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)
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
