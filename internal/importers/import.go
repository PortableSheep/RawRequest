package importers

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// DetectFormat detects whether a path is a Postman collection JSON file or a Bruno collection directory.
// Returns "postman", "bruno", or error.
func DetectFormat(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("cannot access path: %w", err)
	}

	if info.IsDir() {
		// Bruno directories contain .bru files
		entries, err := os.ReadDir(path)
		if err != nil {
			return "", fmt.Errorf("cannot read directory: %w", err)
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".bru") {
				return "bruno", nil
			}
		}
		return "", fmt.Errorf("directory does not appear to be a Bruno collection (no .bru files found)")
	}

	// File - check if it's Postman JSON
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read file: %w", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("file is not valid JSON: %w", err)
	}

	if _, hasInfo := raw["info"]; hasInfo {
		if _, hasItem := raw["item"]; hasItem {
			return "postman", nil
		}
	}

	if _, hasValues := raw["values"]; hasValues {
		return "postman-env", nil
	}

	return "", fmt.Errorf("unrecognized file format")
}

// ImportFromPath auto-detects format and imports the collection.
func ImportFromPath(path string) (*ImportResult, error) {
	format, err := DetectFormat(path)
	if err != nil {
		return nil, err
	}

	switch format {
	case "postman":
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("cannot read file: %w", err)
		}
		return ParsePostmanCollection(data)
	case "bruno":
		return ImportBrunoCollection(path)
	default:
		return nil, fmt.Errorf("unsupported format: %s", format)
	}
}
