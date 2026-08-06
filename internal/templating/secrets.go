package templating

import (
	"regexp"
	"strings"
)

// secretPattern matches {{secret:KEY}} placeholders. Shared by every mode
// that needs to resolve vault-backed secrets from raw request text.
var secretPattern = regexp.MustCompile(`\{\{\s*secret:([^}\r\n]+?)\s*\}\}`)

// SecretLookup resolves a secret by name. Implementations are expected to be
// scoped to whatever "environment" concept the caller cares about (e.g. CLI's
// active --env, or a vault fallback chain); ResolveSecrets itself is
// environment-agnostic and only handles placeholder matching/substitution.
type SecretLookup func(key string) (string, bool)

// ResolveSecrets replaces {{secret:KEY}} placeholders using the supplied
// lookup function. Placeholders whose key cannot be resolved (lookup missing
// or returning ok=false) are left untouched so callers can surface a warning
// or leave the raw text visible for debugging, matching prior per-mode
// behavior. A nil lookup is a no-op, returning input unchanged.
func ResolveSecrets(input string, lookup SecretLookup) string {
	if lookup == nil || input == "" {
		return input
	}
	return secretPattern.ReplaceAllStringFunc(input, func(match string) string {
		sub := secretPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := strings.TrimSpace(sub[1])
		val, ok := lookup(key)
		if !ok {
			return match
		}
		return val
	})
}

// ResolveSystemEnviron replaces {{env.VAR}} placeholders with values from the
// supplied environment listing (typically os.Environ()). This is distinct
// from Resolve's {{env.*}} handling, which looks up the currently active
// named environment profile rather than OS process environment variables.
func ResolveSystemEnviron(input string, environ []string) string {
	if input == "" {
		return input
	}
	result := input
	for _, env := range environ {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			result = strings.ReplaceAll(result, "{{env."+parts[0]+"}}", parts[1])
		}
	}
	return result
}
