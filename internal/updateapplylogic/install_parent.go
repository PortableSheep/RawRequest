package updateapplylogic

import (
	"errors"
	"path/filepath"
	"strings"
)

func InstallParentDir(installPath string) (string, error) {
	parent := installPath
	if strings.HasSuffix(strings.ToLower(strings.TrimSpace(installPath)), ".app") {
		parent = filepath.Dir(installPath)
	}
	if strings.TrimSpace(parent) == "" {
		return "", errors.New("could not determine install parent directory")
	}
	return parent, nil
}
