package migrations

import (
	"os"
	"path/filepath"
)

// mkdirAndWrite is a tiny helper used by tests in this package; placed in
// a non-_test.go-only helper file so it doesn't pollute the public API.
func mkdirAndWrite(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
