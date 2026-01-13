package scripthelpers

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
)

func ToStringMap(value interface{}) map[string]string {
	result := make(map[string]string)
	switch data := value.(type) {
	case map[string]string:
		for k, v := range data {
			result[k] = v
		}
	case map[string]interface{}:
		for k, v := range data {
			result[k] = fmt.Sprint(v)
		}
	case goja.Value:
		return ToStringMap(data.Export())
	case nil:
		// no-op
	default:
		if str, ok := data.(string); ok {
			result[str] = ""
		}
	}
	return result
}

func ToInterfaceMap(value goja.Value) map[string]interface{} {
	if value == nil {
		return nil
	}
	switch data := value.Export().(type) {
	case map[string]interface{}:
		return data
	default:
		return nil
	}
}

func MergeStringMaps(dst, src map[string]string) map[string]string {
	if dst == nil {
		dst = make(map[string]string, len(src))
	}
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func BuildMessageFromArgs(args []goja.Value) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, ValueToString(arg.Export()))
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func ValueToString(val interface{}) string {
	switch v := val.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case map[string]interface{}, []interface{}:
		if data, err := json.Marshal(v); err == nil {
			return string(data)
		}
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func DurationFromValue(val interface{}) (time.Duration, bool) {
	switch v := val.(type) {
	case int:
		return time.Duration(v) * time.Millisecond, true
	case int32:
		return time.Duration(v) * time.Millisecond, true
	case int64:
		return time.Duration(v) * time.Millisecond, true
	case float32:
		ms := float64(v)
		if ms < 0 {
			ms = 0
		}
		return time.Duration(ms * float64(time.Millisecond)), true
	case float64:
		ms := v
		if ms < 0 {
			ms = 0
		}
		return time.Duration(ms * float64(time.Millisecond)), true
	case string:
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			if parsed < 0 {
				parsed = 0
			}
			return time.Duration(parsed * float64(time.Millisecond)), true
		}
	case goja.Value:
		return DurationFromValue(v.Export())
	case nil:
		return 0, false
	default:
		if num, ok := v.(fmt.Stringer); ok {
			if parsed, err := strconv.ParseFloat(num.String(), 64); err == nil {
				if parsed < 0 {
					parsed = 0
				}
				return time.Duration(parsed * float64(time.Millisecond)), true
			}
		}
	}
	return 0, false
}
