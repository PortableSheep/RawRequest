package parsehttp

import (
	"fmt"
	"os"
	"strings"

	"rawrequest/internal/cli"
)

// Block represents a parsed text block corresponding to a request in a .http file.
type Block struct {
	Lines     []string
	StartLine int
	EndLine   int
	Name      string
}

// RequestData holds the structured representation of a request for creation/updates.
type RequestData struct {
	Name       string            `json:"name"`
	Method     string            `json:"method"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       string            `json:"body,omitempty"`
	PreScript  string            `json:"preScript,omitempty"`
	PostScript string            `json:"postScript,omitempty"`
	Group      string            `json:"group,omitempty"`
	Depends    string            `json:"depends,omitempty"`
	Timeout    int               `json:"timeout,omitempty"`
}

// ParseBlocks partitions a .http file content into discrete request blocks.
func ParseBlocks(content string) []Block {
	lines := strings.Split(content, "\n")
	var blocks []Block
	var currentLines []string
	startLine := 0

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Split on standard separator lines starting with ### (aligning with cli/parser.go)
		if strings.HasPrefix(trimmed, "###") && !strings.HasPrefix(trimmed, "### @group") {
			if len(currentLines) > 0 || i > 0 {
				blocks = append(blocks, Block{
					Lines:     currentLines,
					StartLine: startLine,
					EndLine:   i - 1,
					Name:      parseNameFromBlock(currentLines),
				})
			}
			currentLines = []string{line}
			startLine = i
			continue
		}
		currentLines = append(currentLines, line)
	}

	if len(currentLines) > 0 {
		blocks = append(blocks, Block{
			Lines:     currentLines,
			StartLine: startLine,
			EndLine:   len(lines) - 1,
			Name:      parseNameFromBlock(currentLines),
		})
	}
	return blocks
}

// parseNameFromBlock extracts the request name from a block's lines, supporting commented/uncommented forms.
func parseNameFromBlock(lines []string) string {
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		
		// Handle optional commented directives like '# @name get-users' or '// @name get-users'
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			commentContent := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(trimmed, "#"), "//"))
			if strings.HasPrefix(commentContent, "@name ") {
				return strings.TrimSpace(commentContent[6:])
			}
			// Also support older 'name: get-users' format in comments
			if strings.HasPrefix(commentContent, "name:") {
				return strings.TrimSpace(strings.TrimPrefix(commentContent, "name:"))
			}
		}

		if strings.HasPrefix(trimmed, "@name ") {
			return strings.TrimSpace(trimmed[6:])
		}
	}
	
	if len(lines) > 0 {
		first := strings.TrimSpace(lines[0])
		if strings.HasPrefix(first, "###") {
			meta := strings.TrimPrefix(first, "###")
			meta = strings.TrimSpace(meta)
			if strings.HasPrefix(meta, "name:") {
				return strings.TrimSpace(strings.TrimPrefix(meta, "name:"))
			}
		}
	}
	return ""
}

// extractComments extracts developer comments from original block lines to preserve them.
func extractComments(lines []string) []string {
	var comments []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			commentContent := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(trimmed, "#"), "//"))
			// Exclude built-in directives
			if strings.HasPrefix(commentContent, "@name") ||
				strings.HasPrefix(commentContent, "@depends") ||
				strings.HasPrefix(commentContent, "@timeout") ||
				strings.HasPrefix(commentContent, "name:") ||
				strings.HasPrefix(commentContent, "depends:") ||
				strings.HasPrefix(commentContent, "timeout:") {
				continue
			}
			comments = append(comments, line)
		}
	}
	return comments
}

// FormatRequest formats a RequestData struct into a clean .http block string.
func FormatRequest(req RequestData, comments []string) string {
	var sb strings.Builder
	sb.WriteString("###\n")
	
	// Prepend developer comments
	for _, comment := range comments {
		sb.WriteString(comment + "\n")
	}

	// Standard JetBrains directives must not be commented out for parser.go
	if req.Name != "" {
		sb.WriteString(fmt.Sprintf("@name %s\n", req.Name))
	}
	if req.Group != "" {
		sb.WriteString(fmt.Sprintf("### @group %s\n", req.Group))
	}
	if req.Depends != "" {
		sb.WriteString(fmt.Sprintf("@depends %s\n", req.Depends))
	}
	if req.Timeout > 0 {
		sb.WriteString(fmt.Sprintf("@timeout %d\n", req.Timeout))
	}
	
	sb.WriteString(fmt.Sprintf("%s %s\n", req.Method, req.URL))
	
	for k, v := range req.Headers {
		sb.WriteString(fmt.Sprintf("%s: %s\n", k, v))
	}
	
	if req.Body != "" || req.PreScript != "" || req.PostScript != "" {
		sb.WriteString("\n")
	}
	
	if req.Body != "" {
		sb.WriteString(req.Body)
		if !strings.HasSuffix(req.Body, "\n") {
			sb.WriteString("\n")
		}
	}
	
	if req.PreScript != "" {
		sb.WriteString("\n< {\n")
		sb.WriteString(req.PreScript)
		if !strings.HasSuffix(req.PreScript, "\n") {
			sb.WriteString("\n")
		}
		sb.WriteString("}\n")
	}
	
	if req.PostScript != "" {
		sb.WriteString("\n> {\n")
		sb.WriteString(req.PostScript)
		if !strings.HasSuffix(req.PostScript, "\n") {
			sb.WriteString("\n")
		}
		sb.WriteString("}\n")
	}
	
	return sb.String()
}

// WriteRequestToFile appends a new request or updates an existing one in a .http file.
func WriteRequestToFile(filePath string, req RequestData) error {
	contentBytes, err := os.ReadFile(filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		// File does not exist, create a new one with this request
		formatted := FormatRequest(req, nil)
		return os.WriteFile(filePath, []byte(formatted), 0644)
	}

	content := string(contentBytes)
	blocks := ParseBlocks(content)

	targetIdx := -1
	if req.Name != "" {
		for i, block := range blocks {
			if strings.EqualFold(block.Name, req.Name) {
				targetIdx = i
				break
			}
		}
	}

	lines := strings.Split(content, "\n")

	if targetIdx != -1 {
		block := blocks[targetIdx]
		comments := extractComments(block.Lines)
		
		// Parse existing request to merge fields
		blockContent := strings.Join(block.Lines, "\n")
		parsed := cli.ParseHttpFile(blockContent)
		
		var existingReq cli.Request
		if len(parsed.Requests) > 0 {
			existingReq = parsed.Requests[0]
		}

		merged := RequestData{
			Name:       req.Name,
			Method:     req.Method,
			URL:        req.URL,
			Headers:    req.Headers,
			Body:       req.Body,
			PreScript:  req.PreScript,
			PostScript: req.PostScript,
			Group:      req.Group,
			Depends:    req.Depends,
			Timeout:    req.Timeout,
		}

		if merged.Method == "" {
			merged.Method = existingReq.Method
		}
		if merged.URL == "" {
			merged.URL = existingReq.URL
		}
		if merged.Headers == nil {
			merged.Headers = existingReq.Headers
		}
		if merged.Body == "" {
			merged.Body = existingReq.Body
		}
		if merged.PreScript == "" {
			merged.PreScript = existingReq.PreScript
		}
		if merged.PostScript == "" {
			merged.PostScript = existingReq.PostScript
		}
		if merged.Group == "" {
			merged.Group = existingReq.Group
		}
		if merged.Depends == "" {
			merged.Depends = existingReq.Depends
		}
		if merged.Timeout == 0 {
			merged.Timeout = existingReq.Timeout
		}

		formatted := FormatRequest(merged, comments)
		formattedLines := strings.Split(strings.TrimSuffix(formatted, "\n"), "\n")

		var newLines []string
		newLines = append(newLines, lines[:block.StartLine]...)
		newLines = append(newLines, formattedLines...)
		newLines = append(newLines, lines[block.EndLine+1:]...)

		return os.WriteFile(filePath, []byte(strings.Join(newLines, "\n")), 0644)
	}

	formatted := FormatRequest(req, nil)
	
	if len(content) > 0 && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	if len(content) > 0 && !strings.HasSuffix(content, "\n\n") {
		content += "\n"
	}
	content += formatted

	return os.WriteFile(filePath, []byte(content), 0644)
}

// UpdateRequestInFile updates an existing request in a .http file by name.
func UpdateRequestInFile(filePath string, name string, req RequestData) error {
	contentBytes, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	content := string(contentBytes)
	blocks := ParseBlocks(content)

	targetIdx := -1
	for i, block := range blocks {
		if strings.EqualFold(block.Name, name) {
			targetIdx = i
			break
		}
	}

	if targetIdx == -1 {
		return fmt.Errorf("request with name '%s' not found in file", name)
	}

	block := blocks[targetIdx]
	comments := extractComments(block.Lines)
	
	blockContent := strings.Join(block.Lines, "\n")
	parsed := cli.ParseHttpFile(blockContent)
	
	var existingReq cli.Request
	if len(parsed.Requests) > 0 {
		existingReq = parsed.Requests[0]
	}

	merged := RequestData{
		Name:       req.Name,
		Method:     req.Method,
		URL:        req.URL,
		Headers:    req.Headers,
		Body:       req.Body,
		PreScript:  req.PreScript,
		PostScript: req.PostScript,
		Group:      req.Group,
		Depends:    req.Depends,
		Timeout:    req.Timeout,
	}

	if merged.Name == "" {
		merged.Name = existingReq.Name
	}
	if merged.Method == "" {
		merged.Method = existingReq.Method
	}
	if merged.URL == "" {
		merged.URL = existingReq.URL
	}
	if merged.Headers == nil {
		merged.Headers = existingReq.Headers
	}
	if merged.Body == "" {
		merged.Body = existingReq.Body
	}
	if merged.PreScript == "" {
		merged.PreScript = existingReq.PreScript
	}
	if merged.PostScript == "" {
		merged.PostScript = existingReq.PostScript
	}
	if merged.Group == "" {
		merged.Group = existingReq.Group
	}
	if merged.Depends == "" {
		merged.Depends = existingReq.Depends
	}
	if merged.Timeout == 0 {
		merged.Timeout = existingReq.Timeout
	}

	formatted := FormatRequest(merged, comments)
	formattedLines := strings.Split(strings.TrimSuffix(formatted, "\n"), "\n")

	lines := strings.Split(content, "\n")
	var newLines []string
	newLines = append(newLines, lines[:block.StartLine]...)
	newLines = append(newLines, formattedLines...)
	newLines = append(newLines, lines[block.EndLine+1:]...)

	return os.WriteFile(filePath, []byte(strings.Join(newLines, "\n")), 0644)
}

// SaveVariableInFile adds or updates a variable definition in a .http file.
func SaveVariableInFile(filePath string, key string, value string, environment string) error {
	contentBytes, err := os.ReadFile(filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		var varLine string
		if environment != "" {
			varLine = fmt.Sprintf("@env.%s.%s = %s\n", environment, key, value)
		} else {
			varLine = fmt.Sprintf("@%s = %s\n", key, value)
		}
		return os.WriteFile(filePath, []byte(varLine), 0644)
	}

	content := string(contentBytes)
	lines := strings.Split(content, "\n")

	var targetPrefix string
	var newline string
	if environment != "" {
		targetPrefix = fmt.Sprintf("@env.%s.%s", environment, key)
		newline = fmt.Sprintf("@env.%s.%s = %s", environment, key, value)
	} else {
		targetPrefix = fmt.Sprintf("@%s", key)
		newline = fmt.Sprintf("@%s = %s", key, value)
	}

	targetIdx := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, targetPrefix) {
			rest := strings.TrimPrefix(trimmed, targetPrefix)
			rest = strings.TrimSpace(rest)
			if rest == "" || strings.HasPrefix(rest, "=") {
				targetIdx = i
				break
			}
		}
	}

	if targetIdx != -1 {
		lines[targetIdx] = newline
		return os.WriteFile(filePath, []byte(strings.Join(lines, "\n")), 0644)
	}

	lastVarIdx := findLastVariableLine(lines)
	
	var newLines []string
	if lastVarIdx != -1 {
		newLines = append(newLines, lines[:lastVarIdx+1]...)
		newLines = append(newLines, newline)
		newLines = append(newLines, lines[lastVarIdx+1:]...)
	} else {
		newLines = append(newLines, newline)
		if len(lines) > 0 && strings.TrimSpace(lines[0]) != "" {
			newLines = append(newLines, "")
		}
		newLines = append(newLines, lines...)
	}

	return os.WriteFile(filePath, []byte(strings.Join(newLines, "\n")), 0644)
}

func findLastVariableLine(lines []string) int {
	lastIdx := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "@") {
			// Exclude request directives from variables block
			if strings.HasPrefix(trimmed, "@name") ||
				strings.HasPrefix(trimmed, "@depends") ||
				strings.HasPrefix(trimmed, "@timeout") {
				break
			}
			lastIdx = i
		} else if !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "//") {
			break
		}
	}
	return lastIdx
}
