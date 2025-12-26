package updateapplylogic

import (
	"errors"
	"path/filepath"
	"strings"
)

// InstallParentDir returns the directory that should be probed for write access
// when installing to installPath.
//
// On macOS, installPath may be a .app bundle, in which case the parent directory
// is probed (since writing alongside the .app is what matters).
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
