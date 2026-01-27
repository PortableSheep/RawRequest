package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// HistoryItem represents a single history entry derived from a response file.
// This is used internally when loading history from response files.
type HistoryItem struct {
	Timestamp    string                 `json:"timestamp"`
	Method       string                 `json:"method"`
	URL          string                 `json:"url"`
	Status       int                    `json:"status"`
	StatusText   string                 `json:"statusText"`
	ResponseTime float64                `json:"responseTime"`
	ResponseData map[string]interface{} `json:"responseData"`
}

// loadHistoryFromResponsesDir scans the given responses directory and builds
// a history array from individual response JSON files.
func (a *App) loadHistoryFromResponsesDir(responsesDir string) string {
	entries, err := os.ReadDir(responsesDir)
	if err != nil {
		return "[]"
	}

	var items []HistoryItem
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		filePath := filepath.Join(responsesDir, entry.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var respData map[string]interface{}
		if err := json.Unmarshal(data, &respData); err != nil {
			continue
		}

		// Build history item from response data
		item := HistoryItem{
			ResponseData: respData,
		}

		// Extract timestamp from filename (response-YYYYMMDD-HHMMSS.json)
		name := entry.Name()
		if strings.HasPrefix(name, "response-") && strings.HasSuffix(name, ".json") {
			ts := strings.TrimPrefix(name, "response-")
			ts = strings.TrimSuffix(ts, ".json")
			// Convert from 20060102-150405 to ISO format
			if len(ts) == 15 { // YYYYMMDD-HHMMSS
				item.Timestamp = ts[0:4] + "-" + ts[4:6] + "-" + ts[6:8] + "T" + ts[9:11] + ":" + ts[11:13] + ":" + ts[13:15] + ".000Z"
			}
		}

		// Extract method and url from requestPreview or chainItems
		if reqPreview, ok := respData["requestPreview"].(map[string]interface{}); ok {
			if m, ok := reqPreview["method"].(string); ok {
				item.Method = m
			}
			if u, ok := reqPreview["url"].(string); ok {
				item.URL = u
			}
		}
		if item.URL == "" {
			if u, ok := respData["processedUrl"].(string); ok {
				item.URL = u
			}
		}

		// Extract status info
		if s, ok := respData["status"].(float64); ok {
			item.Status = int(s)
		}
		if st, ok := respData["statusText"].(string); ok {
			item.StatusText = st
		}
		if rt, ok := respData["responseTime"].(float64); ok {
			item.ResponseTime = rt
		}

		items = append(items, item)
	}

	// Sort by timestamp descending (newest first)
	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})

	result, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(result)
}

// LoadFileHistory loads history for a file from the app-specific responses directory.
func (a *App) LoadFileHistory(fileID string) string {
	if fileID == "" {
		return "[]"
	}
	appDir := a.getAppDir()
	safe := a.sanitizeFileID(fileID)
	responsesDir := filepath.Join(appDir, "responses", safe+".responses")
	return a.loadHistoryFromResponsesDir(responsesDir)
}

// LoadFileHistoryFromDir loads history from response files in the given directory.
// For saved .http files, the httpFilePath is provided and we look in {httpFileName}.responses/
func (a *App) LoadFileHistoryFromDir(fileID string, dir string) string {
	if fileID == "" || dir == "" {
		return "[]"
	}
	// dir is the directory containing the .http file
	// Look for {baseName}.responses/ folder where baseName matches sanitized fileID
	safe := a.sanitizeFileID(fileID)
	responsesDir := filepath.Join(dir, safe+".responses")
	return a.loadHistoryFromResponsesDir(responsesDir)
}

// LoadFileHistoryFromHttpFile loads history from the .responses folder adjacent to an .http file.
func (a *App) LoadFileHistoryFromHttpFile(httpFilePath string) string {
	if httpFilePath == "" {
		return "[]"
	}
	dir := filepath.Dir(httpFilePath)
	base := filepath.Base(httpFilePath)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	responsesDir := filepath.Join(dir, name+".responses")
	return a.loadHistoryFromResponsesDir(responsesDir)
}

// LoadFileHistoryFromRunLocation loads history from response files in the working directory.
func (a *App) LoadFileHistoryFromRunLocation(fileID string) string {
	wd, err := os.Getwd()
	if err != nil {
		return "[]"
	}
	safe := a.sanitizeFileID(fileID)
	// Same pattern as saved files: {fileId}.responses/
	responsesDir := filepath.Join(wd, safe+".responses")
	return a.loadHistoryFromResponsesDir(responsesDir)
}

func (a *App) sanitizeFileID(fileID string) string {
	// Keep history filenames safe + stable across OS/filesystems.
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "-")
	return replacer.Replace(fileID)
}
