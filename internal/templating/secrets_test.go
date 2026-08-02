package templating

import "testing"

func TestResolveSecrets(t *testing.T) {
	lookup := func(key string) (string, bool) {
		switch key {
		case "apiKey":
			return "secret-123", true
		case "dbPass":
			return "pass-456", true
		default:
			return "", false
		}
	}

	tests := []struct {
		name     string
		input    string
		lookup   SecretLookup
		expected string
	}{
		{
			name:     "no placeholder",
			input:    "plain text",
			lookup:   lookup,
			expected: "plain text",
		},
		{
			name:     "single resolved secret",
			input:    "key={{secret:apiKey}}",
			lookup:   lookup,
			expected: "key=secret-123",
		},
		{
			name:     "multiple resolved secrets",
			input:    "{{secret:apiKey}}:{{secret:dbPass}}",
			lookup:   lookup,
			expected: "secret-123:pass-456",
		},
		{
			name:     "unresolved secret left as-is",
			input:    "{{secret:unknown}}",
			lookup:   lookup,
			expected: "{{secret:unknown}}",
		},
		{
			name:     "whitespace around key is trimmed",
			input:    "{{ secret: apiKey }}",
			lookup:   lookup,
			expected: "secret-123",
		},
		{
			name:     "nil lookup is a no-op",
			input:    "{{secret:apiKey}}",
			lookup:   nil,
			expected: "{{secret:apiKey}}",
		},
		{
			name:     "empty input",
			input:    "",
			lookup:   lookup,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveSecrets(tt.input, tt.lookup)
			if got != tt.expected {
				t.Errorf("ResolveSecrets(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestResolveSystemEnviron(t *testing.T) {
	environ := []string{
		"RAWREQUEST_TEST_VAR=hello",
		"MALFORMED_NO_EQUALS_SIGN",
		"RAWREQUEST_TEST_OTHER=world",
	}

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "resolves a single system env var",
			input:    "value={{env.RAWREQUEST_TEST_VAR}}",
			expected: "value=hello",
		},
		{
			name:     "resolves multiple system env vars",
			input:    "{{env.RAWREQUEST_TEST_VAR}}-{{env.RAWREQUEST_TEST_OTHER}}",
			expected: "hello-world",
		},
		{
			name:     "unknown env var left as-is",
			input:    "{{env.DOES_NOT_EXIST}}",
			expected: "{{env.DOES_NOT_EXIST}}",
		},
		{
			name:     "malformed environ entries are skipped without panic",
			input:    "still-here",
			expected: "still-here",
		},
		{
			name:     "empty input",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveSystemEnviron(tt.input, environ)
			if got != tt.expected {
				t.Errorf("ResolveSystemEnviron(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
