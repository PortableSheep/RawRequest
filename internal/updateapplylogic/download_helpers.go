package updateapplylogic

import (
	"time"
)

const ProgressEmitInterval = 150 * time.Millisecond

// TempArtifactPattern builds the os.CreateTemp pattern used for downloaded artifacts.
func TempArtifactPattern(url string) string {
	return "rawrequest-update-artifact-*" + ArchiveSuffixFromURL(url)
}

// BuildDownloadProgressPayload matches the frontend payload expectations:
// always include "written"; include "total" and "percent" only when total > 0.
func BuildDownloadProgressPayload(written, total int64) map[string]any {
	payload := map[string]any{"written": written}
	if total > 0 {
		payload["total"] = total
		payload["percent"] = float64(written) / float64(total)
	}
	return payload
}

// ShouldEmitProgress indicates whether a progress update should be emitted.
// It mirrors the existing behavior: emit at most every ProgressEmitInterval,
// and always emit when total > 0 and written == total.
func ShouldEmitProgress(lastEmit, now time.Time, written, total int64) bool {
	if total > 0 && written == total {
		return true
	}
	return now.Sub(lastEmit) > ProgressEmitInterval
}
