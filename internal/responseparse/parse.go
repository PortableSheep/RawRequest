package responseparse

import (
	"encoding/json"
	"strconv"
	"strings"
)

// Parse parses the response string into structured data for scripts.
// Response format: "Status: 200 OK\nHeaders: {...json...}\nBody: ..."
func Parse(response string) map[string]interface{} {
	result := make(map[string]interface{})
	lines := strings.Split(response, "\n")

	for i := 0; i < len(lines); i++ {
		line := lines[i]

		// Parse status line: "Status: 200 OK"
		if strings.HasPrefix(line, "Status: ") {
			statusLine := strings.TrimPrefix(line, "Status: ")
			parts := strings.SplitN(statusLine, " ", 2)
			if len(parts) > 0 {
				if statusCode, err := strconv.Atoi(parts[0]); err == nil {
					result["status"] = statusCode
				}
				if len(parts) > 1 {
					result["statusText"] = parts[1]
				}
			}
			continue
		}

		// Parse headers: "Headers: {...ResponseMetadata JSON...}"
		if strings.HasPrefix(line, "Headers: ") {
			metadataStr := strings.TrimPrefix(line, "Headers: ")
			var metadata struct {
				Headers map[string]string `json:"headers"`
				Timing  struct {
					Total int64 `json:"total"`
				} `json:"timing"`
				Size int64 `json:"size"`
			}
			if err := json.Unmarshal([]byte(metadataStr), &metadata); err == nil {
				if metadata.Headers != nil {
					result["headers"] = metadata.Headers
				} else {
					result["headers"] = make(map[string]string)
				}
				result["responseTime"] = metadata.Timing.Total
				result["size"] = metadata.Size
			} else {
				result["headers"] = make(map[string]string)
			}
			continue
		}

		// Parse body: "Body: ..." (may span multiple lines)
		if strings.HasPrefix(line, "Body: ") {
			body := strings.TrimPrefix(line, "Body: ")
			if i+1 < len(lines) {
				body += "\n" + strings.Join(lines[i+1:], "\n")
			}
			result["body"] = body
			result["text"] = body

			var jsonData interface{}
			if err := json.Unmarshal([]byte(body), &jsonData); err == nil {
				result["json"] = jsonData
			}
			break
		}
	}

	if _, exists := result["headers"]; !exists {
		result["headers"] = make(map[string]string)
	}

	return result
}
