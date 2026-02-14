package cli

import (
	"regexp"
	"strings"
)

// ParsedHttpFile represents a parsed .http file
type ParsedHttpFile struct {
	Requests     []Request
	Environments map[string]map[string]string
	Variables    map[string]string
}

// Request represents an HTTP request from the file
type Request struct {
	Name       string
	Method     string
	URL        string
	Headers    map[string]string
	Body       string
	PreScript  string
	PostScript string
	Group      string
	Depends    string
	Timeout    int
}

var (
	envVarRegex    = regexp.MustCompile(`^@env\.(\w+)\.(\w+)\s*(?:=|\s+)\s*(.+)$`)
	globalVarRegex = regexp.MustCompile(`^@(\w+)\s*=?\s*(.*)$`)
	methodRegex    = regexp.MustCompile(`^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$`)
	headerRegex    = regexp.MustCompile(`^([^:]+):\s*(.+)$`)
)

// ParseHttpFile parses an .http file content and returns structured data
func ParseHttpFile(content string) *ParsedHttpFile {
	lines := strings.Split(content, "\n")
	result := &ParsedHttpFile{
		Requests:     []Request{},
		Environments: make(map[string]map[string]string),
		Variables:    make(map[string]string),
	}

	var currentRequest *Request
	var requestBody strings.Builder
	inBody := false
	inHeaders := false
	var pendingName, pendingGroup, pendingDepends string
	pendingTimeout := 0

	// Script block tracking
	inPreScript := false
	inPostScript := false
	var preScript, postScript strings.Builder
	braceDepth := 0
	braceStarted := false
	pendingBraceScript := "" // "<" or ">"

	finalizeRequest := func() {
		if currentRequest == nil {
			return
		}
		body := strings.TrimSpace(requestBody.String())
		if body != "" {
			currentRequest.Body = body
		}
		if preScript.Len() > 0 {
			currentRequest.PreScript = strings.TrimSpace(preScript.String())
		}
		if postScript.Len() > 0 {
			currentRequest.PostScript = strings.TrimSpace(postScript.String())
		}
		result.Requests = append(result.Requests, *currentRequest)
		currentRequest = nil
		requestBody.Reset()
		preScript.Reset()
		postScript.Reset()
		inBody = false
		inHeaders = false
		// Note: Do NOT clear pendingName/pendingGroup/pendingDepends/pendingTimeout here.
		// These are metadata for the NEXT request and should only be cleared after
		// they are applied to a new request.
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Handle brace script bodies
		if inPreScript || inPostScript {
			if inPreScript {
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
				inPreScript = false
				inPostScript = false
				braceDepth = 0
				braceStarted = false
			}
			continue
		}

		// Handle pending brace script marker
		if pendingBraceScript != "" {
			if strings.HasPrefix(trimmed, "{") {
				if pendingBraceScript == "<" {
					inPreScript = true
					preScript.WriteString(line + "\n")
				} else {
					inPostScript = true
					postScript.WriteString(line + "\n")
				}
				pendingBraceScript = ""
				braceDepth = 0
				braceStarted = false
				openCount := strings.Count(line, "{")
				closeCount := strings.Count(line, "}")
				if openCount > 0 {
					braceStarted = true
				}
				braceDepth += openCount - closeCount
				if braceStarted && braceDepth <= 0 {
					inPreScript = false
					inPostScript = false
					braceDepth = 0
					braceStarted = false
				}
				continue
			}
			pendingBraceScript = ""
		}

		// Request separator: ### ... (check before comments since separators start with #)
		if isSeparatorLine(trimmed) {
			finalizeRequest()
			// Parse separator metadata like ### @group:mygroup or ### name: myname
			meta := strings.TrimPrefix(trimmed, "###")
			meta = strings.TrimSpace(meta)
			if strings.HasPrefix(meta, "@group") || strings.HasPrefix(meta, "group:") {
				if strings.HasPrefix(meta, "@group") {
					pendingGroup = strings.TrimSpace(strings.TrimPrefix(meta, "@group"))
				} else {
					pendingGroup = strings.TrimSpace(strings.TrimPrefix(meta, "group:"))
				}
			} else if strings.HasPrefix(meta, "name:") {
				pendingName = strings.TrimSpace(strings.TrimPrefix(meta, "name:"))
			}
			continue
		}

		// Comments (after separator check)
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}

		// Empty line - transition between headers and body
		if trimmed == "" {
			if inHeaders && !inBody {
				inBody = true
			} else if inBody {
				requestBody.WriteString("\n")
			}
			continue
		}

		// Environment variables: @env.envName.varName = value
		if match := envVarRegex.FindStringSubmatch(trimmed); match != nil {
			envName := match[1]
			varName := match[2]
			value := match[3]
			if result.Environments[envName] == nil {
				result.Environments[envName] = make(map[string]string)
			}
			result.Environments[envName][varName] = value
			continue
		}

		// @tab - file display name, ignore
		if strings.HasPrefix(trimmed, "@tab ") {
			continue
		}

		// @name directive
		if strings.HasPrefix(trimmed, "@name ") {
			pendingName = strings.TrimSpace(trimmed[6:])
			continue
		}

		// @depends directive
		if strings.HasPrefix(trimmed, "@depends ") {
			pendingDepends = strings.TrimSpace(trimmed[9:])
			continue
		}

		// @timeout directive
		if strings.HasPrefix(trimmed, "@timeout ") {
			var t int
			if _, err := parseTimeout(strings.TrimSpace(trimmed[9:])); err == nil {
				pendingTimeout = t
			}
			continue
		}

		// @no-history - ignore for CLI
		if trimmed == "@no-history" || strings.HasPrefix(trimmed, "@no-history ") {
			continue
		}

		// @load - ignore load test config for CLI (for now)
		if strings.HasPrefix(trimmed, "@load ") {
			continue
		}

		// Global variables: @varName = value
		if strings.HasPrefix(trimmed, "@") {
			if match := globalVarRegex.FindStringSubmatch(trimmed); match != nil {
				result.Variables[match[1]] = match[2]
			}
			continue
		}

		// Script markers: < or > (standalone or with {)
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
						inPreScript = true
						preScript.WriteString(line + "\n")
					} else {
						inPostScript = true
						postScript.WriteString(line + "\n")
					}
					braceDepth = 0
					braceStarted = false
					openCount := strings.Count(line, "{")
					closeCount := strings.Count(line, "}")
					if openCount > 0 {
						braceStarted = true
					}
					braceDepth += openCount - closeCount
					if braceStarted && braceDepth <= 0 {
						inPreScript = false
						inPostScript = false
						braceDepth = 0
						braceStarted = false
					}
					inHeaders = false
					inBody = false
					continue
				}
			}
		}

		// Method line: GET https://example.com
		if match := methodRegex.FindStringSubmatch(trimmed); match != nil {
			if currentRequest != nil {
				finalizeRequest()
			}
			currentRequest = &Request{
				Name:    pendingName,
				Method:  match[1],
				URL:     match[2],
				Headers: make(map[string]string),
				Group:   pendingGroup,
				Depends: pendingDepends,
				Timeout: pendingTimeout,
			}
			pendingName = ""
			pendingGroup = ""
			pendingDepends = ""
			pendingTimeout = 0
			inHeaders = true
			inBody = false
			requestBody.Reset()
			continue
		}

		// Header line: Key: Value
		if inHeaders && !inBody {
			if match := headerRegex.FindStringSubmatch(trimmed); match != nil {
				currentRequest.Headers[match[1]] = match[2]
				continue
			}
			// Not a header, transition to body
			inBody = true
		}

		// Body
		if inBody && currentRequest != nil {
			requestBody.WriteString(line + "\n")
		}
	}

	finalizeRequest()
	return result
}

func isSeparatorLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "###")
}

func parseTimeout(s string) (int, error) {
	var t int
	_, err := strings.NewReader(s).Read(make([]byte, 0))
	// Simple parse - in production would use strconv
	return t, err
}

// FindRequestsByName returns requests matching the given names
func (p *ParsedHttpFile) FindRequestsByName(names []string) []Request {
	if len(names) == 0 {
		return p.Requests
	}
	var result []Request
	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[strings.ToLower(n)] = true
	}
	for _, req := range p.Requests {
		if nameSet[strings.ToLower(req.Name)] {
			result = append(result, req)
		}
	}
	return result
}

// ListRequests returns a summary of all requests
func (p *ParsedHttpFile) ListRequests() []RequestSummary {
	var summaries []RequestSummary
	for i, req := range p.Requests {
		name := req.Name
		if name == "" {
			name = "(unnamed)"
		}
		summaries = append(summaries, RequestSummary{
			Index:  i + 1,
			Name:   name,
			Method: req.Method,
			URL:    req.URL,
			Group:  req.Group,
		})
	}
	return summaries
}

// RequestSummary is a brief description of a request for listing
type RequestSummary struct {
	Index  int
	Name   string
	Method string
	URL    string
	Group  string
}

// ListEnvironments returns all environment names
func (p *ParsedHttpFile) ListEnvironments() []string {
	var envs []string
	for name := range p.Environments {
		envs = append(envs, name)
	}
	return envs
}
