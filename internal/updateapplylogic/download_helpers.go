package updateapplylogic

import (
	"time"
)

const ProgressEmitInterval = 150 * time.Millisecond

func TempArtifactPattern(url string) string {
	return "rawrequest-update-artifact-*" + ArchiveSuffixFromURL(url)
}

func BuildDownloadProgressPayload(written, total int64) map[string]any {
	payload := map[string]any{"written": written}
	if total > 0 {
		payload["total"] = total
		payload["percent"] = float64(written) / float64(total)
	}
	return payload
}

func ShouldEmitProgress(lastEmit, now time.Time, written, total int64) bool {
	if total > 0 && written == total {
		return true
	}
	return now.Sub(lastEmit) > ProgressEmitInterval
}
