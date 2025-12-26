package parsehttp

import "strings"

func IsNewRequestSeparatorLine(trimmed string) bool {
	if !strings.HasPrefix(trimmed, "###") {
		return false
	}
	// Directives are not separators.
	if strings.HasPrefix(trimmed, "### @group") {
		return false
	}
	after := strings.TrimPrefix(trimmed, "###")
	if after == "" {
		return false
	}
	// Require at least one space/tab after ###.
	if after[0] != ' ' && after[0] != '\t' {
		return false
	}
	rest := strings.TrimLeft(after, " \t")
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return false
	}
	// Ignore visual dividers like "### #######".
	if strings.Trim(rest, "#") == "" {
		return false
	}
	return true
}
