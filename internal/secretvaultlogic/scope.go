package secretvaultlogic

import (
	"path/filepath"
	"strings"
)

// FileScopePrefix marks a vault "environment" bucket that is scoped to a
// single .http file. The full bucket name is "@file:<env>:<absolute path>".
// Environment names never contain ':' so the first ':' after the prefix
// separates the env from the path (which may itself contain ':' on Windows).
const FileScopePrefix = "@file:"

// NormalizeScopePath canonicalizes a file path so the same file always maps to
// the same scope regardless of how it was referenced (relative, unclean, ...).
func NormalizeScopePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if abs, err := filepath.Abs(trimmed); err == nil {
		trimmed = abs
	}
	return filepath.Clean(trimmed)
}

// FileScopedEnv builds the vault bucket name for a secret scoped to filePath
// within env. Returns "" when filePath is empty (unsaved tabs have no file scope).
func FileScopedEnv(filePath, env string) string {
	path := NormalizeScopePath(filePath)
	if path == "" {
		return ""
	}
	return FileScopePrefix + NormalizeEnv(env) + ":" + path
}

// ParseFileScopedEnv splits a bucket name produced by FileScopedEnv.
func ParseFileScopedEnv(bucket string) (env, filePath string, ok bool) {
	if !strings.HasPrefix(bucket, FileScopePrefix) {
		return "", "", false
	}
	rest := bucket[len(FileScopePrefix):]
	idx := strings.Index(rest, ":")
	if idx <= 0 || idx == len(rest)-1 {
		return "", "", false
	}
	return rest[:idx], rest[idx+1:], true
}

// SecretLookupChain returns the ordered vault buckets to search for a secret
// referenced from filePath while env is active. Most specific scope wins:
// file+env, file+default, env, default.
func SecretLookupChain(filePath, env string) []string {
	env = NormalizeEnv(env)
	candidates := []string{
		FileScopedEnv(filePath, env),
		FileScopedEnv(filePath, "default"),
		env,
		"default",
	}
	seen := make(map[string]bool, len(candidates))
	chain := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		chain = append(chain, c)
	}
	return chain
}
