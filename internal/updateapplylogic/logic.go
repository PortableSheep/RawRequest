package updateapplylogic

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ArchiveSuffixFromURL returns a recognized archive suffix for the given URL.
func ArchiveSuffixFromURL(url string) string {
	lower := strings.ToLower(strings.TrimSpace(url))
	switch {
	case strings.HasSuffix(lower, ".tar.gz"):
		return ".tar.gz"
	case strings.HasSuffix(lower, ".tgz"):
		return ".tgz"
	case strings.HasSuffix(lower, ".zip"):
		return ".zip"
	default:
		return ""
	}
}

func DetermineInstallPath(goos string, exePath string) (string, error) {
	switch goos {
	case "darwin":
		// Expect: /path/RawRequest.app/Contents/MacOS/RawRequest
		exeDir := filepath.Dir(exePath)
		contentsDir := filepath.Dir(exeDir)
		appPath := filepath.Dir(contentsDir)
		if !strings.HasSuffix(strings.ToLower(appPath), ".app") {
			return "", fmt.Errorf("could not determine app bundle path from %s", exePath)
		}
		return appPath, nil
	case "windows":
		// Treat install path as directory containing RawRequest.exe
		return filepath.Dir(exePath), nil
	default:
		return "", fmt.Errorf("auto-update not supported on %s", goos)
	}
}

func DetermineUpdaterPath(goos string, exePath string) (string, error) {
	exeDir := filepath.Dir(exePath)
	switch goos {
	case "darwin":
		return filepath.Join(exeDir, "rawrequest-updater"), nil
	case "windows":
		return filepath.Join(exeDir, "rawrequest-updater.exe"), nil
	default:
		return "", fmt.Errorf("auto-update not supported on %s", goos)
	}
}

func BuildArtifactURL(goos string, latestVersion string, owner string, repo string) (string, error) {
	v := strings.TrimPrefix(strings.TrimSpace(latestVersion), "v")
	tag := "v" + v

	var asset string
	switch goos {
	case "darwin":
		asset = fmt.Sprintf("RawRequest-%s-macos-universal.tar.gz", tag)
	case "windows":
		asset = fmt.Sprintf("RawRequest-%s-windows-portable.zip", v)
	default:
		return "", fmt.Errorf("auto-update not supported on %s", goos)
	}

	return fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/%s", owner, repo, tag, asset), nil
}

func PreparedUpdateFieldsComplete(version, artifactPath, sha256 string) bool {
	return strings.TrimSpace(version) != "" && strings.TrimSpace(artifactPath) != "" && strings.TrimSpace(sha256) != ""
}
