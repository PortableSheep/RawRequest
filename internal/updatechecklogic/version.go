package updatechecklogic

import (
	"regexp"
	"strconv"
	"strings"
)

var versionRe = regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?`)

// ParseVersion extracts major, minor, patch from a version string.
// It tolerates a leading "v" and ignores any trailing non-numeric metadata.
func ParseVersion(v string) [3]int {
	v = strings.TrimPrefix(v, "v")

	matches := versionRe.FindStringSubmatch(v)

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

// IsNewerVersion compares two semantic version strings.
// Returns true if latest is newer than current.
func IsNewerVersion(latest, current string) bool {
	latestParts := ParseVersion(latest)
	currentParts := ParseVersion(current)

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
