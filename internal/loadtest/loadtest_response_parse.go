package loadtest

import (
	"encoding/json"
	"strconv"
	"strings"
)

func ParseStatusAndTiming(result string) (status int, timingMs int64) {
	status = 0
	timingMs = 0

	// Fast parse "Status: 200 OK".
	if strings.HasPrefix(result, "Status: ") {
		lineEnd := strings.IndexByte(result, '\n')
		statusLine := result
		if lineEnd > 0 {
			statusLine = result[:lineEnd]
		}
		parts := strings.Fields(strings.TrimPrefix(statusLine, "Status: "))
		if len(parts) > 0 {
			if n, err := strconv.Atoi(parts[0]); err == nil {
				status = n
			}
		}
	}

	// Parse timing.total from the metadata JSON in the "Headers:" section.
	hIdx := strings.Index(result, "\nHeaders: ")
	bIdx := strings.Index(result, "\nBody: ")
	if hIdx >= 0 && bIdx > hIdx {
		headersStr := strings.TrimSpace(result[hIdx+len("\nHeaders: ") : bIdx])
		if headersStr != "" {
			var meta struct {
				Timing struct {
					Total int64 `json:"total"`
				} `json:"timing"`
			}
			if json.Unmarshal([]byte(headersStr), &meta) == nil {
				timingMs = meta.Timing.Total
			}
		}
	}

	return status, timingMs
}
