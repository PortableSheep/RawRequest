package templating

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

var variableRegex = regexp.MustCompile(`\{\{([^}]+)\}\}`)

func Resolve(input string, variables map[string]string, envVars map[string]string, responseStore map[string]map[string]interface{}) string {
	if input == "" {
		return input
	}

	jsonCache := map[string]map[string]interface{}{}
	return variableRegex.ReplaceAllStringFunc(input, func(match string) string {
		expr := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}"))
		if expr == "" {
			return match
		}

		parts := strings.Split(expr, ".")
		if len(parts) == 0 {
			return match
		}

		// requestN.response.*
		if len(parts) >= 2 && strings.HasPrefix(parts[0], "request") {
			if val, ok := responseReferenceValue(parts, responseStore, jsonCache); ok {
				return val
			}
			return match
		}

		// variables.* and env.*
		if len(parts) >= 2 {
			switch parts[0] {
			case "variables":
				key := strings.Join(parts[1:], ".")
				if val, ok := variables[key]; ok {
					return val
				}
			case "env":
				key := strings.Join(parts[1:], ".")
				if val, ok := envVars[key]; ok {
					return val
				}
			}
		}

		// bare {{key}}
		if val, ok := variables[expr]; ok {
			return val
		}

		return match
	})
}

// ResolveResponseReferences replaces {{requestN.response...}} placeholders
// using values from a positional response store (populated by chain
// execution, where requestN refers to the Nth request executed in the
// current chain, 1-indexed — see requestchain.ResponseStoreKey). It shares
// the exact lookup semantics Resolve uses for its "request" branch (via
// responseReferenceValue), so CLI/MCP chains and the Desktop app's
// requestchain.Execute agree on {{requestN.response...}} resolution.
//
// Unlike Resolve, this function does not attempt bare {{key}}, {{variables.*}},
// or {{env.*}} substitution at all — it only ever touches placeholders shaped
// like requestN.response.*, leaving everything else (including secrets and
// plain variables) untouched for a caller-specific resolution pass. This
// lets CLI/MCP layer response-store resolution on top of their own existing
// (and already divergent from Desktop, e.g. bare {{key}} falling back to an
// environment-profile variable) variable/secret/env resolution instead of
// switching them over to Resolve wholesale and risking behavior changes.
func ResolveResponseReferences(input string, responseStore map[string]map[string]interface{}) string {
	if input == "" || len(responseStore) == 0 {
		return input
	}

	jsonCache := map[string]map[string]interface{}{}
	return variableRegex.ReplaceAllStringFunc(input, func(match string) string {
		expr := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(match, "{{"), "}}"))
		if expr == "" {
			return match
		}

		parts := strings.Split(expr, ".")
		if len(parts) < 2 || !strings.HasPrefix(parts[0], "request") {
			return match
		}

		if val, ok := responseReferenceValue(parts, responseStore, jsonCache); ok {
			return val
		}
		return match
	})
}

// responseReferenceValue resolves a single requestN.response.* placeholder
// (already split on ".") against responseStore, mirroring the exact
// fallthrough semantics the original inline implementation had: it returns
// ok=false only for the cases that should leave the raw placeholder in
// place (unknown request key, non-"response" field, unresolvable status,
// missing header, or a body that fails JSON parsing when a nested path is
// requested). A known JSON path that simply isn't present in the body
// resolves to "" (ok=true) rather than leaving the placeholder, matching
// existing behavior.
func responseReferenceValue(parts []string, responseStore map[string]map[string]interface{}, jsonCache map[string]map[string]interface{}) (string, bool) {
	requestKey := parts[0]
	resp, exists := responseStore[requestKey]
	if !exists {
		return "", false
	}

	if len(parts) < 3 || parts[1] != "response" {
		return "", false
	}

	switch parts[2] {
	case "body":
		body, _ := resp["body"].(string)
		if body == "" {
			return "", false
		}
		if len(parts) == 3 {
			return body, true
		}
		path := strings.Join(parts[3:], ".")
		if cached, ok := jsonCache[requestKey]; ok {
			return getJSONValue(cached, path), true
		}
		var jsonData map[string]interface{}
		if err := json.Unmarshal([]byte(body), &jsonData); err == nil {
			jsonCache[requestKey] = jsonData
			return getJSONValue(jsonData, path), true
		}
	case "status":
		if status, ok := resp["status"].(int); ok {
			return strconv.Itoa(status), true
		}
	case "headers":
		if len(parts) >= 4 {
			if headers, ok := resp["headers"].(map[string]string); ok {
				if val, ok := headers[parts[3]]; ok {
					return val, true
				}
			}
		}
	}

	return "", false
}

// getJSONValue extracts a value from JSON using dot notation.
// This matches the existing app behavior: objects-only traversal (no array indexing).
func getJSONValue(data map[string]interface{}, path string) string {
	parts := strings.Split(path, ".")
	current := data

	for i, part := range parts {
		if i == len(parts)-1 {
			if val, exists := current[part]; exists {
				switch v := val.(type) {
				case string:
					return v
				case float64:
					return strconv.FormatFloat(v, 'f', -1, 64)
				case bool:
					return strconv.FormatBool(v)
				default:
					if jsonBytes, err := json.Marshal(v); err == nil {
						return string(jsonBytes)
					}
				}
			}
		} else {
			if next, ok := current[part].(map[string]interface{}); ok {
				current = next
			} else {
				break
			}
		}
	}

	return ""
}
