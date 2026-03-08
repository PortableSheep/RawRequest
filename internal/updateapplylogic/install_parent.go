package updateapplylogic

import (
	"errors"
	"path/filepath"
	"strings"
)

func InstallParentDir(installPath string) (string, error) {
	trimmed := strings.TrimSpace(installPath)
	if trimmed == "" {
		return "", errors.New("could not determine install parent directory")
	}
	parent := filepath.Dir(trimmed)
	if parent == "" || parent == trimmed {
		return "", errors.New("could not determine install parent directory")
	}
	return parent, nil
}
