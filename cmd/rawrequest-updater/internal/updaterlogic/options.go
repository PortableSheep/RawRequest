package updaterlogic

import (
	"errors"
	"strings"
)

type Options struct {
	InstallPath  string
	ArtifactURL  string
	ArtifactPath string
}

func ValidateOptions(o Options) error {
	if strings.TrimSpace(o.InstallPath) == "" {
		return errors.New("missing --install-path")
	}

	hasURL := strings.TrimSpace(o.ArtifactURL) != ""
	hasPath := strings.TrimSpace(o.ArtifactPath) != ""

	if !hasURL && !hasPath {
		return errors.New("missing --artifact-url (or --artifact-path)")
	}
	if hasURL && hasPath {
		return errors.New("provide only one of --artifact-url or --artifact-path")
	}

	return nil
}

type ArtifactFormat int

const (
	ArtifactZip ArtifactFormat = iota
	ArtifactTarGz
)

func ArtifactLabel(o Options) string {
	if strings.TrimSpace(o.ArtifactPath) != "" {
		return o.ArtifactPath
	}
	return o.ArtifactURL
}

func ArtifactFormatsForLabel(label string) []ArtifactFormat {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		return []ArtifactFormat{ArtifactZip, ArtifactTarGz}
	}

	lower := strings.ToLower(trimmed)

	if strings.HasSuffix(lower, ".zip") {
		return []ArtifactFormat{ArtifactZip}
	}
	if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
		return []ArtifactFormat{ArtifactTarGz}
	}

	return []ArtifactFormat{ArtifactZip, ArtifactTarGz}
}
