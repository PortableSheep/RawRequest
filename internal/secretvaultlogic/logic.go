package secretvaultlogic

import (
	"errors"
	"sort"
	"strings"
)

func NormalizeEnv(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "default"
	}
	return trimmed
}

func NormalizeKey(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("secret key cannot be empty")
	}
	return trimmed, nil
}

func SnapshotSecretKeys(secrets map[string]map[string]string) map[string][]string {
	result := make(map[string][]string)
	for env, entries := range secrets {
		keys := make([]string, 0, len(entries))
		for key := range entries {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		result[env] = keys
	}
	return result
}
