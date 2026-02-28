package mcp

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// skipDirs contains directory names to exclude from file discovery.
var skipDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	"vendor":       true,
	"dist":         true,
	"build":        true,
	".next":        true,
	"__pycache__":  true,
}

// DiscoverHttpFiles finds all .http files under the given root directory,
// skipping common non-source directories. Returns paths relative to root.
func DiscoverHttpFiles(root string) ([]string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	var files []string
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if skipDirs[name] {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(info.Name()), ".http") {
			rel, err := filepath.Rel(root, path)
			if err != nil {
				rel = path
			}
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Strings(files)
	return files, nil
}

// ResolveFilePath resolves a potentially relative file path against the workspace root.
// If the file path is absolute, it is returned as-is.
func ResolveFilePath(workspace, file string) string {
	if filepath.IsAbs(file) {
		return file
	}
	return filepath.Join(workspace, file)
}
