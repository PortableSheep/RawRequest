package updatechecklogic

import "testing"

func TestLatestReleaseAPIURL(t *testing.T) {
	got := LatestReleaseAPIURL("octo", "repo")
	want := "https://api.github.com/repos/octo/repo/releases/latest"
	if got != want {
		t.Fatalf("LatestReleaseAPIURL()=%q want %q", got, want)
	}
}

func TestListReleasesAPIURL(t *testing.T) {
	got := ListReleasesAPIURL("octo", "repo", 10)
	want := "https://api.github.com/repos/octo/repo/releases?per_page=10"
	if got != want {
		t.Fatalf("ListReleasesAPIURL()=%q want %q", got, want)
	}
}

func TestListReleasesAPIURL_DefaultsPerPage(t *testing.T) {
	got := ListReleasesAPIURL("octo", "repo", 0)
	want := "https://api.github.com/repos/octo/repo/releases?per_page=10"
	if got != want {
		t.Fatalf("ListReleasesAPIURL(0)=%q want %q", got, want)
	}
}

func TestBuildLatestReleaseRequest_SetsHeaders(t *testing.T) {
	req, err := BuildLatestReleaseRequest("octo", "repo", "My-UA")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Method != "GET" {
		t.Fatalf("method=%q want GET", req.Method)
	}
	if req.URL.String() != "https://api.github.com/repos/octo/repo/releases/latest" {
		t.Fatalf("url=%q", req.URL.String())
	}
	if req.Header.Get("Accept") != "application/vnd.github.v3+json" {
		t.Fatalf("accept=%q", req.Header.Get("Accept"))
	}
	if req.Header.Get("User-Agent") != "My-UA" {
		t.Fatalf("user-agent=%q", req.Header.Get("User-Agent"))
	}
}

func TestBuildListReleasesRequest_SetsHeaders(t *testing.T) {
	req, err := BuildListReleasesRequest("octo", "repo", "My-UA", 15)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Method != "GET" {
		t.Fatalf("method=%q want GET", req.Method)
	}
	want := "https://api.github.com/repos/octo/repo/releases?per_page=15"
	if req.URL.String() != want {
		t.Fatalf("url=%q want %q", req.URL.String(), want)
	}
	if req.Header.Get("Accept") != "application/vnd.github.v3+json" {
		t.Fatalf("accept=%q", req.Header.Get("Accept"))
	}
	if req.Header.Get("User-Agent") != "My-UA" {
		t.Fatalf("user-agent=%q", req.Header.Get("User-Agent"))
	}
}
