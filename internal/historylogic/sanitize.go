package historylogic

import "strings"

func SanitizeFileID(fileID string) string {
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "-")
	return replacer.Replace(fileID)
}
