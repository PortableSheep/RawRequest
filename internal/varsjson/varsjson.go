package varsjson

import (
	"encoding/json"
	"fmt"
)

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
