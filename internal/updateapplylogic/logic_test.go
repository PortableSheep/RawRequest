package updateapplylogic

import "testing"

func TestArchiveSuffixFromURL(t *testing.T) {
	cases := []struct {
		url  string
		want string
	}{
		{"https://x/y.tgz", ".tgz"},
		{"https://x/y.tar.gz", ".tar.gz"},
		{"https://x/y.zip", ".zip"},
		{" https://x/y.ZIP ", ".zip"},
		{"https://x/y", ""},
	}
	for _, tc := range cases {
		if got := ArchiveSuffixFromURL(tc.url); got != tc.want {
			t.Fatalf("ArchiveSuffixFromURL(%q)=%q want %q", tc.url, got, tc.want)
		}
	}
}

func TestDetermineInstallPath(t *testing.T) {
	got, err := DetermineInstallPath("darwin", "/Applications/RawRequest.app/Contents/MacOS/RawRequest")
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if got != "/Applications/RawRequest.app" {
		t.Fatalf("expected app bundle path, got %q", got)
	}

	_, err = DetermineInstallPath("darwin", "/tmp/not-a-bundle/bin/rawrequest")
	if err == nil {
		t.Fatalf("expected error")
	}

	got, err = DetermineInstallPath("windows", "C:/Apps/RawRequest/RawRequest.exe")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if got != "C:/Apps/RawRequest" {
		t.Fatalf("expected install dir, got %q", got)
	}
}

func TestDetermineUpdaterPath(t *testing.T) {
	got, err := DetermineUpdaterPath("darwin", "/Applications/RawRequest.app/Contents/MacOS/RawRequest")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if got != "/Applications/RawRequest.app/Contents/MacOS/rawrequest-updater" {
		t.Fatalf("unexpected path: %q", got)
	}

	got, err = DetermineUpdaterPath("windows", "C:/Apps/RawRequest/RawRequest.exe")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if got != "C:/Apps/RawRequest/rawrequest-updater.exe" {
		t.Fatalf("unexpected path: %q", got)
	}
}

func TestBuildArtifactURL(t *testing.T) {
	url, err := BuildArtifactURL("darwin", "v1.2.3", "o", "r")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if url != "https://github.com/o/r/releases/download/v1.2.3/RawRequest-v1.2.3-macos-universal.tar.gz" {
		t.Fatalf("unexpected url: %q", url)
	}

	url, err = BuildArtifactURL("windows", "1.2.3", "o", "r")
	if err != nil {
		t.Fatalf("expected nil error")
	}
	if url != "https://github.com/o/r/releases/download/v1.2.3/RawRequest-1.2.3-windows-portable.zip" {
		t.Fatalf("unexpected url: %q", url)
	}
}

func TestPreparedUpdateFieldsComplete(t *testing.T) {
	if PreparedUpdateFieldsComplete("", "a", "b") {
		t.Fatalf("expected false")
	}
	if !PreparedUpdateFieldsComplete("v", "a", "b") {
		t.Fatalf("expected true")
	}
	if PreparedUpdateFieldsComplete("v", " ", "b") {
		t.Fatalf("expected false")
	}
}
