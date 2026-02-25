package importers

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

type PostmanCollection struct {
	Info     PostmanInfo   `json:"info"`
	Item     []PostmanItem `json:"item"`
	Variable []PostmanVar  `json:"variable"`
}

type PostmanInfo struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
}

type PostmanItem struct {
	Name    string          `json:"name"`
	Request *PostmanRequest `json:"request"`
	Item    []PostmanItem   `json:"item"`
}

type PostmanRequest struct {
	Method string          `json:"method"`
	Header []PostmanHeader `json:"header"`
	URL    json.RawMessage `json:"url"`
	Body   *PostmanBody    `json:"body"`
}

type PostmanHeader struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Disabled bool   `json:"disabled"`
}

type PostmanURL struct {
	Raw string `json:"raw"`
}

type PostmanBody struct {
	Mode string `json:"mode"`
	Raw  string `json:"raw"`
}

type PostmanVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type PostmanEnvironment struct {
	Name   string              `json:"name"`
	Values []PostmanEnvValue   `json:"values"`
}

type PostmanEnvValue struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type ImportResult struct {
	Files []ImportedFile
}

type ImportedFile struct {
	Name    string
	Content string
}

var nameCleanRe = regexp.MustCompile(`[^a-zA-Z0-9 _-]`)

func sanitizeName(name string) string {
	return strings.TrimSpace(nameCleanRe.ReplaceAllString(name, ""))
}

func resolveURL(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	// Try as a plain string first.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}

	// Try as an object with a "raw" field.
	var obj PostmanURL
	if err := json.Unmarshal(raw, &obj); err == nil {
		return obj.Raw
	}

	return ""
}

func writeItems(sb *strings.Builder, items []PostmanItem) {
	for _, item := range items {
		if item.Request == nil && len(item.Item) > 0 {
			// Folder
			fmt.Fprintf(sb, "\n### --- %s ---\n", item.Name)
			writeItems(sb, item.Item)
			continue
		}
		if item.Request == nil {
			continue
		}

		req := item.Request
		url := resolveURL(req.URL)
		safeName := sanitizeName(item.Name)

		fmt.Fprintf(sb, "\n### %s\n", item.Name)
		if safeName != "" {
			fmt.Fprintf(sb, "@name %s\n", safeName)
		}
		fmt.Fprintf(sb, "%s %s\n", req.Method, url)

		for _, h := range req.Header {
			if h.Disabled {
				continue
			}
			fmt.Fprintf(sb, "%s: %s\n", h.Key, h.Value)
		}

		if req.Body != nil && req.Body.Mode == "raw" && req.Body.Raw != "" {
			fmt.Fprintf(sb, "\n%s\n", req.Body.Raw)
		}
	}
}

// ParsePostmanCollection converts Postman Collection v2.1 JSON into .http file content.
func ParsePostmanCollection(data []byte) (*ImportResult, error) {
	var col PostmanCollection
	if err := json.Unmarshal(data, &col); err != nil {
		return nil, fmt.Errorf("invalid Postman collection JSON: %w", err)
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "# Imported from Postman: %s\n", col.Info.Name)

	for _, v := range col.Variable {
		fmt.Fprintf(&sb, "\n@%s = %s", v.Key, v.Value)
	}
	if len(col.Variable) > 0 {
		sb.WriteString("\n")
	}

	writeItems(&sb, col.Item)

	name := col.Info.Name
	if name == "" {
		name = "imported"
	}

	return &ImportResult{
		Files: []ImportedFile{
			{
				Name:    name + ".http",
				Content: sb.String(),
			},
		},
	}, nil
}

// ParsePostmanEnvironment converts a Postman environment JSON into variable lines
// that can be prepended to an .http file.
func ParsePostmanEnvironment(data []byte) ([]PostmanVar, error) {
	var env PostmanEnvironment
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("invalid Postman environment JSON: %w", err)
	}

	var vars []PostmanVar
	for _, v := range env.Values {
		if !v.Enabled {
			continue
		}
		vars = append(vars, PostmanVar{Key: v.Key, Value: v.Value})
	}
	return vars, nil
}
