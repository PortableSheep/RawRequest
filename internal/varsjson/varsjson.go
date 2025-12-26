package varsjson

import (
	"encoding/json"
	"fmt"
)

// ApplyFromJSON parses responseBody as a JSON object and stores values into vars.
// Behavior matches the prior App.ParseResponseForVariables + setVariablesFromMap:
// - Only JSON objects are supported (arrays/other roots are ignored).
// - Stores strings directly.
// - Stores numbers (float64 from encoding/json) as integer-formatted strings ("%.0f").
// - Recurses into nested objects.
// - Ignores other value types.
func ApplyFromJSON(vars map[string]string, responseBody string) {
	if vars == nil {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(responseBody), &data); err != nil {
		return
	}
	ApplyFromMap(vars, "", data)
}

// ApplyFromMap recursively walks a nested JSON-object map and writes eligible values into vars.
func ApplyFromMap(vars map[string]string, prefix string, data map[string]interface{}) {
	if vars == nil || data == nil {
		return
	}
	for key, value := range data {
		fullKey := key
		if prefix != "" {
			fullKey = prefix + "." + key
		}
		switch v := value.(type) {
		case string:
			vars[fullKey] = v
		case float64:
			vars[fullKey] = fmt.Sprintf("%.0f", v)
		case map[string]interface{}:
			ApplyFromMap(vars, fullKey, v)
		}
	}
}
