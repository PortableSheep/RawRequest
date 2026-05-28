package cli

import (
	"regexp"
	"strconv"
	"strings"
	"time"
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
	LoadConfig map[string]any
	IsMock     bool
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
	var pendingLoadConfig map[string]any
	pendingIsMock := false
	inLoadBlock := false

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
		// Note: Do NOT clear pendingName/pendingGroup/pendingDepends/pendingTimeout/pendingLoadConfig here.
		// These are metadata for the NEXT request and should only be cleared after
		// they are applied to a new request.
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if inLoadBlock {
			if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
				continue
			}
			if !methodRegex.MatchString(trimmed) && !strings.HasPrefix(trimmed, "@") && !isSeparatorLine(trimmed) {
				if config, ok := parseLoadConfigText(trimmed); ok {
					pendingLoadConfig = mergeLoadConfig(pendingLoadConfig, config)
					continue
				}
			}
			inLoadBlock = false
		}

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
			if t, err := parseTimeout(strings.TrimSpace(trimmed[9:])); err == nil {
				pendingTimeout = t
			}
			continue
		}

		// @no-history - ignore for CLI
		if trimmed == "@no-history" || strings.HasPrefix(trimmed, "@no-history ") {
			continue
		}

		// @load - support inline key/value config and block style config on following lines.
		if trimmed == "@load" {
			if pendingLoadConfig == nil {
				pendingLoadConfig = map[string]any{}
			}
			inLoadBlock = true
			continue
		}
		if strings.HasPrefix(trimmed, "@load ") {
			if config, ok := parseLoadConfigText(strings.TrimSpace(trimmed[len("@load"):])); ok {
				pendingLoadConfig = mergeLoadConfig(pendingLoadConfig, config)
			}
			continue
		}

		// @mockinit directive
		if trimmed == "@mockinit" || strings.HasPrefix(trimmed, "@mockinit ") {
			if currentRequest == nil {
				currentRequest = &Request{
					Headers: make(map[string]string),
				}
			}
			currentRequest.Name = pendingName
			currentRequest.Group = pendingGroup
			currentRequest.IsMock = true
			currentRequest.Method = "MOCKINIT"
			currentRequest.URL = "@mockinit"
			pendingName = ""
			pendingGroup = ""
			pendingDepends = ""
			pendingTimeout = 0
			pendingLoadConfig = nil
			pendingIsMock = false
			continue
		}

		// @mock directive
		if trimmed == "@mock" || strings.HasPrefix(trimmed, "@mock ") {
			pendingIsMock = true
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
				Name:       pendingName,
				Method:     match[1],
				URL:        match[2],
				Headers:    make(map[string]string),
				Group:      pendingGroup,
				Depends:    pendingDepends,
				Timeout:    pendingTimeout,
				LoadConfig: cloneLoadConfig(pendingLoadConfig),
				IsMock:     pendingIsMock,
			}
			pendingName = ""
			pendingGroup = ""
			pendingDepends = ""
			pendingTimeout = 0
			pendingLoadConfig = nil
			pendingIsMock = false
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
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, strconv.ErrSyntax
	}
	if millis, err := strconv.Atoi(s); err == nil {
		return millis, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, err
	}
	return int(d / time.Millisecond), nil
}

func parseLoadConfigText(raw string) (map[string]any, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, false
	}

	pairRx := regexp.MustCompile(`([A-Za-z_][\w-]*)\s*(?:=|:)\s*("[^"]*"|'[^']*'|[^\s,]+)`)
	matches := pairRx.FindAllStringSubmatch(raw, -1)
	if len(matches) == 0 {
		return nil, false
	}

	config := make(map[string]any, len(matches))
	for _, match := range matches {
		key := normalizeLoadKey(match[1])
		if key == "" {
			continue
		}
		value := strings.TrimSpace(match[2])
		value = strings.Trim(value, `"'`)
		config[key] = parseLoadValue(key, value)
	}
	if len(config) == 0 {
		return nil, false
	}
	return config, true
}

func normalizeLoadKey(raw string) string {
	key := strings.ToLower(strings.TrimSpace(raw))
	key = strings.ReplaceAll(key, "-", "")
	key = strings.ReplaceAll(key, "_", "")

	switch key {
	case "concurrency", "concurrent", "users", "user", "u":
		return "concurrent"
	case "amount", "requests", "requestcount", "iterations", "count":
		return "iterations"
	case "runtime", "duration", "time":
		return "duration"
	case "delay", "wait", "waittime", "thinktime":
		return "delay"
	case "minwait", "waitmin":
		return "waitMin"
	case "maxwait", "waitmax":
		return "waitMax"
	case "ramp", "rampup":
		return "rampUp"
	case "spawnrate", "r":
		return "spawnRate"
	case "start":
		return "start"
	case "startusers":
		return "startUsers"
	case "max":
		return "max"
	case "maxusers":
		return "maxUsers"
	case "rps", "requestspersecond", "targetrps":
		return "requestsPerSecond"
	case "failureratethreshold", "failurethreshold", "failthreshold", "failrate", "maxfailurerate", "maxfailure", "failpct", "failurepct":
		return "failureRateThreshold"
	case "adaptive", "autobackoff", "autoadjust", "autotune", "backoff", "stablebackoff":
		return "adaptive"
	case "adaptivefailurerate", "adaptivefailrate", "adaptivefailure", "adaptivefailurethreshold", "adaptivethreshold":
		return "adaptiveFailureRate"
	case "adaptivewindow", "window", "windowsec", "windows":
		return "adaptiveWindow"
	case "adaptivestable", "stablesec", "stablefor", "stable":
		return "adaptiveStable"
	case "adaptivecooldown", "cooldown":
		return "adaptiveCooldown"
	case "adaptivebackoffstep", "backoffstep", "backoffusers":
		return "adaptiveBackoffStep"
	default:
		return strings.TrimSpace(raw)
	}
}

func parseLoadValue(key, raw string) any {
	switch key {
	case "concurrent", "iterations", "spawnRate", "start", "startUsers", "max", "maxUsers", "requestsPerSecond", "adaptiveBackoffStep":
		if n, err := strconv.Atoi(raw); err == nil {
			return n
		}
	case "adaptive":
		if b, err := strconv.ParseBool(strings.ToLower(raw)); err == nil {
			return b
		}
	}
	return raw
}

func mergeLoadConfig(base, extra map[string]any) map[string]any {
	if len(extra) == 0 {
		return cloneLoadConfig(base)
	}
	merged := cloneLoadConfig(base)
	if merged == nil {
		merged = map[string]any{}
	}
	for key, value := range extra {
		merged[key] = value
	}
	return merged
}

func cloneLoadConfig(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
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
