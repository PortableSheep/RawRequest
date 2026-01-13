package templating

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

func Resolve(input string, variables map[string]string, envVars map[string]string, responseStore map[string]map[string]interface{}) string {
	if input == "" {
		return input
	}

	variableRegex := regexp.MustCompile(`\{\{([^}]+)\}\}`)
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
			requestKey := parts[0]
			resp, exists := responseStore[requestKey]
			if !exists {
				return match
			}

			if len(parts) >= 3 && parts[1] == "response" {
				switch parts[2] {
				case "body":
					body, _ := resp["body"].(string)
					if body == "" {
						return match
					}
					if len(parts) == 3 {
						return body
					}
					path := strings.Join(parts[3:], ".")
					var jsonData map[string]interface{}
					if err := json.Unmarshal([]byte(body), &jsonData); err == nil {
						return getJSONValue(jsonData, path)
					}
				case "status":
					if status, ok := resp["status"].(int); ok {
						return strconv.Itoa(status)
					}
				case "headers":
					if len(parts) >= 4 {
						if headers, ok := resp["headers"].(map[string]string); ok {
							if val, ok := headers[parts[3]]; ok {
								return val
							}
						}
					}
				}
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
