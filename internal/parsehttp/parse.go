package parsehttp

import (
	"strings"
)

type readFileFunc func(path string) ([]byte, error)

func Parse(content string, variables map[string]string, envVars map[string]string, environ []string, readFile readFileFunc) []map[string]interface{} {
	// First pass: Replace simple variables and env vars.
	for key, value := range variables {
		content = strings.ReplaceAll(content, "{{"+key+"}}", value)
	}
	for key, value := range envVars {
		content = strings.ReplaceAll(content, "{{"+key+"}}", value)
	}

	// Replace environment variables from system.
	for _, env := range environ {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			content = strings.ReplaceAll(content, "{{env."+parts[0]+"}}", parts[1])
		}
	}

	lines := strings.Split(content, "\n")
	var requests []map[string]interface{}
	var currentRequest map[string]interface{}
	var currentBody strings.Builder
	inBody := false
	inHeaders := false
	var currentGroup string
	var preScript strings.Builder
	var postScript strings.Builder

	// Support brace-based script blocks used by the frontend parser:
	//   < { ... }
	//   > { ... }
	//   <\n{ ... }
	//   >\n{ ... }
	var pendingBraceScript string // "<" or ">" when a standalone marker was seen
	inPreBraceScript := false
	inPostBraceScript := false
	braceDepth := 0
	braceStarted := false

	finalizeCurrent := func() {
		if currentRequest == nil {
			return
		}

		bodyStr := strings.TrimSpace(currentBody.String())
		if strings.HasPrefix(bodyStr, "< ") {
			filePath := strings.TrimPrefix(bodyStr, "< ")
			if readFile != nil {
				if b, err := readFile(filePath); err == nil {
					currentRequest["body"] = string(b)
					currentRequest["isFile"] = true
				} else {
					currentRequest["body"] = bodyStr
				}
			} else {
				currentRequest["body"] = bodyStr
			}
		} else {
			currentRequest["body"] = bodyStr
		}

		if currentGroup != "" {
			currentRequest["group"] = currentGroup
		}
		if preScript.Len() > 0 {
			currentRequest["preScript"] = strings.TrimSpace(preScript.String())
			preScript.Reset()
		}
		if postScript.Len() > 0 {
			currentRequest["postScript"] = strings.TrimSpace(postScript.String())
			postScript.Reset()
		}

		requests = append(requests, currentRequest)
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Handle brace script bodies (we only terminate once braces balance).
		if inPreBraceScript || inPostBraceScript {
			if inPreBraceScript {
				preScript.WriteString(line + "\n")
			} else {
				postScript.WriteString(line + "\n")
			}
			openCount := strings.Count(line, "{")
			closeCount := strings.Count(line, "}")
			if openCount > 0 {
				braceStarted = true
			}
			braceDepth += openCount - closeCount
			if braceStarted && braceDepth <= 0 {
				inPreBraceScript = false
				inPostBraceScript = false
				braceDepth = 0
				braceStarted = false
			}
			continue
		}

		// If we saw a standalone < or > marker, only treat the *immediately following* line
		// as a script opener if it begins with '{' (to avoid false-positives with XML bodies).
		if pendingBraceScript != "" {
			if strings.HasPrefix(trimmed, "{") {
				if pendingBraceScript == "<" {
					inPreBraceScript = true
				} else {
					inPostBraceScript = true
				}
				pendingBraceScript = ""
				braceDepth = 0
				braceStarted = false

				// Directly treat this line as part of the script body.
				if inPreBraceScript {
					preScript.WriteString(line + "\n")
				} else {
					postScript.WriteString(line + "\n")
				}
				openCount := strings.Count(line, "{")
				closeCount := strings.Count(line, "}")
				if openCount > 0 {
					braceStarted = true
				}
				braceDepth += openCount - closeCount
				if braceStarted && braceDepth <= 0 {
					inPreBraceScript = false
					inPostBraceScript = false
					braceDepth = 0
					braceStarted = false
				}
				continue
			}
			pendingBraceScript = ""
		}

		if trimmed == "" {
			if inHeaders && !inBody {
				inBody = true
			}
			continue
		}

		// Handle request groups/directives (must run before generic separator handling).
		if strings.HasPrefix(trimmed, "### @group") {
			currentGroup = strings.TrimSpace(strings.TrimPrefix(trimmed, "### @group"))
			continue
		}

		// New request separator.
		if IsNewRequestSeparatorLine(trimmed) {
			finalizeCurrent()
			currentRequest = make(map[string]interface{})
			currentBody.Reset()
			inBody = false
			inHeaders = false
			continue
		}

		// Handle brace-based scripts (< { ... } / > { ... })
		// Must be < or > followed by { on the same line, OR a standalone marker with { on the next line.
		if trimmed == "<" || trimmed == ">" {
			pendingBraceScript = trimmed
			inHeaders = false
			inBody = false
			continue
		}
		if len(trimmed) >= 2 {
			first := trimmed[0]
			if (first == '<' || first == '>') && strings.Contains(trimmed, "{") {
				rest := strings.TrimSpace(trimmed[1:])
				if strings.HasPrefix(rest, "{") {
					if first == '<' {
						inPreBraceScript = true
					} else {
						inPostBraceScript = true
					}
					braceDepth = 0
					braceStarted = false

					if inPreBraceScript {
						preScript.WriteString(line + "\n")
					} else {
						postScript.WriteString(line + "\n")
					}
					openCount := strings.Count(line, "{")
					closeCount := strings.Count(line, "}")
					if openCount > 0 {
						braceStarted = true
					}
					braceDepth += openCount - closeCount
					if braceStarted && braceDepth <= 0 {
						inPreBraceScript = false
						inPostBraceScript = false
						braceDepth = 0
						braceStarted = false
					}
					inHeaders = false
					inBody = false
					continue
				}
			}
		}

		if currentRequest == nil {
			currentRequest = make(map[string]interface{})
		}

		// Request line.
		if !inHeaders && !inBody && strings.Contains(trimmed, " ") && (strings.HasPrefix(trimmed, "GET ") || strings.HasPrefix(trimmed, "POST ") || strings.HasPrefix(trimmed, "PUT ") || strings.HasPrefix(trimmed, "DELETE ") || strings.HasPrefix(trimmed, "PATCH ") || strings.HasPrefix(trimmed, "HEAD ") || strings.HasPrefix(trimmed, "OPTIONS ")) {
			parts := strings.Fields(trimmed)
			if len(parts) >= 2 {
				currentRequest["method"] = parts[0]
				currentRequest["url"] = parts[1]
			}
			inHeaders = true
			continue
		}

		// Header line.
		if inHeaders && !inBody && strings.Contains(trimmed, ":") {
			if currentRequest["headers"] == nil {
				currentRequest["headers"] = make(map[string]string)
			}
			headers := currentRequest["headers"].(map[string]string)
			if idx := strings.Index(trimmed, ":"); idx > 0 {
				key := strings.TrimSpace(trimmed[:idx])
				value := strings.TrimSpace(trimmed[idx+1:])
				headers[key] = value
			}
			continue
		}

		// Body.
		inBody = true
		currentBody.WriteString(line + "\n")
	}

	finalizeCurrent()
	return requests
}
