package importers

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// BrunoRequest represents a parsed Bruno .bru request file.
type BrunoRequest struct {
	Name    string
	Method  string
	URL     string
	Headers map[string]string
	Body    string
}

// BrunoEnvironment represents a parsed Bruno environment file.
type BrunoEnvironment struct {
	Name string
	Vars map[string]string
}

var httpMethods = map[string]bool{
	"get":     true,
	"post":    true,
	"put":     true,
	"delete":  true,
	"patch":   true,
	"head":    true,
	"options": true,
}

// bruBlock represents a parsed block from a .bru file.
type bruBlock struct {
	Name      string
	Qualifier string
	Lines     []string
}

// parseBlocks extracts all blocks from .bru file content.
func parseBlocks(content string) []bruBlock {
	lines := strings.Split(content, "\n")
	var blocks []bruBlock
	var current *bruBlock
	depth := 0

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if current == nil {
			// Look for block start: "name {" or "name:qualifier {"
			if strings.HasSuffix(trimmed, "{") {
				header := strings.TrimSuffix(trimmed, "{")
				header = strings.TrimSpace(header)

				block := bruBlock{}
				if idx := strings.Index(header, ":"); idx >= 0 {
					block.Name = strings.TrimSpace(header[:idx])
					block.Qualifier = strings.TrimSpace(header[idx+1:])
				} else {
					block.Name = header
				}
				current = &block
				depth = 1
			}
		} else {
			// Count nested braces
			if trimmed == "}" && depth == 1 {
				blocks = append(blocks, *current)
				current = nil
				depth = 0
				continue
			}
			for _, ch := range trimmed {
				if ch == '{' {
					depth++
				} else if ch == '}' {
					depth--
				}
			}
			if depth == 0 {
				// Closing brace was part of content with nested braces
				current.Lines = append(current.Lines, line)
				blocks = append(blocks, *current)
				current = nil
				continue
			}
			current.Lines = append(current.Lines, line)
		}
	}
	return blocks
}

// parseKeyValue parses a "key: value" line, splitting on the first ": " or ":".
func parseKeyValue(line string) (string, string, bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "", "", false
	}
	// Try ": " first for cleaner split
	if idx := strings.Index(trimmed, ": "); idx >= 0 {
		return strings.TrimSpace(trimmed[:idx]), strings.TrimSpace(trimmed[idx+2:]), true
	}
	// Fall back to ":"
	if idx := strings.Index(trimmed, ":"); idx >= 0 {
		return strings.TrimSpace(trimmed[:idx]), strings.TrimSpace(trimmed[idx+1:]), true
	}
	return "", "", false
}

// ParseBruFile parses a single .bru file into a BrunoRequest.
func ParseBruFile(content string) (*BrunoRequest, error) {
	blocks := parseBlocks(content)
	req := &BrunoRequest{
		Headers: make(map[string]string),
	}

	for _, block := range blocks {
		switch {
		case block.Name == "meta":
			for _, line := range block.Lines {
				k, v, ok := parseKeyValue(line)
				if ok && k == "name" {
					req.Name = v
				}
			}
		case httpMethods[block.Name]:
			req.Method = strings.ToUpper(block.Name)
			for _, line := range block.Lines {
				k, v, ok := parseKeyValue(line)
				if !ok {
					continue
				}
				if k == "url" {
					req.URL = v
				}
			}
		case block.Name == "headers":
			for _, line := range block.Lines {
				k, v, ok := parseKeyValue(line)
				if ok {
					req.Headers[k] = v
				}
			}
		case block.Name == "body":
			// body:json, body:xml, body:text, etc.
			req.Body = joinBodyLines(block.Lines)
		}
	}

	if req.Method == "" || req.URL == "" {
		return nil, fmt.Errorf("missing HTTP method or URL in .bru file")
	}

	return req, nil
}

// joinBodyLines joins body content lines, trimming leading/trailing blank lines.
func joinBodyLines(lines []string) string {
	// Trim leading blank lines
	start := 0
	for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	// Trim trailing blank lines
	end := len(lines)
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	if start >= end {
		return ""
	}
	return strings.Join(lines[start:end], "\n")
}

// ParseBruEnvironment parses a Bruno environment .bru file and returns the variables.
func ParseBruEnvironment(content string) (map[string]string, error) {
	blocks := parseBlocks(content)
	vars := make(map[string]string)

	for _, block := range blocks {
		if block.Name == "vars" {
			for _, line := range block.Lines {
				k, v, ok := parseKeyValue(line)
				if ok {
					vars[k] = v
				}
			}
		}
	}

	return vars, nil
}

// ImportBrunoCollection reads a Bruno collection directory and converts it to .http format.
func ImportBrunoCollection(dirPath string) (*ImportResult, error) {
	info, err := os.Stat(dirPath)
	if err != nil {
		return nil, fmt.Errorf("cannot access directory: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", dirPath)
	}

	// Parse environments
	envs, err := parseEnvironments(dirPath)
	if err != nil {
		return nil, fmt.Errorf("error parsing environments: %w", err)
	}

	// Collect .bru request files (exclude environments directory)
	type bruEntry struct {
		relDir  string
		request *BrunoRequest
	}
	var entries []bruEntry

	err = filepath.Walk(dirPath, func(path string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		// Skip environments directory
		rel, _ := filepath.Rel(dirPath, path)
		if fi.IsDir() && rel == "environments" {
			return filepath.SkipDir
		}
		if fi.IsDir() || filepath.Ext(path) != ".bru" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading %s: %w", path, err)
		}

		req, err := ParseBruFile(string(data))
		if err != nil {
			return fmt.Errorf("parsing %s: %w", rel, err)
		}

		relDir := filepath.Dir(rel)
		if relDir == "." {
			relDir = ""
		}
		entries = append(entries, bruEntry{relDir: relDir, request: req})
		return nil
	})
	if err != nil {
		return nil, err
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("no .bru request files found in %s", dirPath)
	}

	// Sort entries by directory then name for stable output
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].relDir != entries[j].relDir {
			return entries[i].relDir < entries[j].relDir
		}
		return entries[i].request.Name < entries[j].request.Name
	})

	// Build .http content
	var sb strings.Builder

	// Environment variables
	if len(envs) > 0 {
		envNames := make([]string, 0, len(envs))
		for name := range envs {
			envNames = append(envNames, name)
		}
		sort.Strings(envNames)

		for _, envName := range envNames {
			vars := envs[envName]
			varKeys := make([]string, 0, len(vars))
			for k := range vars {
				varKeys = append(varKeys, k)
			}
			sort.Strings(varKeys)
			for _, k := range varKeys {
				sb.WriteString(fmt.Sprintf("@env.%s.%s %s\n", envName, k, vars[k]))
			}
		}
		sb.WriteString("\n")
	}

	// Requests
	prevDir := ""
	for i, entry := range entries {
		if i > 0 {
			sb.WriteString("\n###\n\n")
		}

		// Folder comment when directory changes
		if entry.relDir != "" && entry.relDir != prevDir {
			sb.WriteString(fmt.Sprintf("# Folder: %s\n\n", entry.relDir))
		}
		prevDir = entry.relDir

		req := entry.request

		if req.Name != "" {
			sb.WriteString(fmt.Sprintf("@name %s\n", req.Name))
		}

		sb.WriteString(fmt.Sprintf("%s %s\n", req.Method, req.URL))

		// Headers sorted for stable output
		if len(req.Headers) > 0 {
			headerKeys := make([]string, 0, len(req.Headers))
			for k := range req.Headers {
				headerKeys = append(headerKeys, k)
			}
			sort.Strings(headerKeys)
			for _, k := range headerKeys {
				sb.WriteString(fmt.Sprintf("%s: %s\n", k, req.Headers[k]))
			}
		}

		if req.Body != "" {
			sb.WriteString("\n")
			sb.WriteString(req.Body)
			sb.WriteString("\n")
		}
	}

	collectionName := filepath.Base(dirPath)
	return &ImportResult{
		Files: []ImportedFile{
			{
				Name:    collectionName + ".http",
				Content: sb.String(),
			},
		},
	}, nil
}

// parseEnvironments reads all .bru files from the environments/ subdirectory.
func parseEnvironments(dirPath string) (map[string]map[string]string, error) {
	envDir := filepath.Join(dirPath, "environments")
	info, err := os.Stat(envDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, nil
	}

	envFiles, err := os.ReadDir(envDir)
	if err != nil {
		return nil, err
	}

	envs := make(map[string]map[string]string)
	for _, f := range envFiles {
		if f.IsDir() || filepath.Ext(f.Name()) != ".bru" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(envDir, f.Name()))
		if err != nil {
			return nil, fmt.Errorf("reading environment %s: %w", f.Name(), err)
		}
		vars, err := ParseBruEnvironment(string(data))
		if err != nil {
			return nil, fmt.Errorf("parsing environment %s: %w", f.Name(), err)
		}
		envName := strings.TrimSuffix(f.Name(), ".bru")
		envs[envName] = vars
	}

	return envs, nil
}
