package templating

import "testing"

func TestResolve_VariablesAndEnv(t *testing.T) {
	variables := map[string]string{
		"token":   "abc",
		"foo.bar": "baz",
	}
	envVars := map[string]string{
		"baseUrl": "https://example.test",
	}
	store := map[string]map[string]interface{}{}

	got := Resolve("Authorization: Bearer {{token}}", variables, envVars, store)
	if got != "Authorization: Bearer abc" {
		t.Fatalf("unexpected resolve: %q", got)
	}

	got = Resolve("X: {{variables.foo.bar}}", variables, envVars, store)
	if got != "X: baz" {
		t.Fatalf("unexpected resolve: %q", got)
	}

	got = Resolve("{{env.baseUrl}}/v1", variables, envVars, store)
	if got != "https://example.test/v1" {
		t.Fatalf("unexpected resolve: %q", got)
	}
}

func TestResolve_RequestResponseStatusHeadersBody(t *testing.T) {
	variables := map[string]string{}
	envVars := map[string]string{}
	store := map[string]map[string]interface{}{
		"request1": {
			"status":  200,
			"headers": map[string]string{"X-Trace": "t123"},
			"body":    `{"user":{"id":123,"name":"alice"}}`,
		},
	}

	got := Resolve("{{request1.response.status}}", variables, envVars, store)
	if got != "200" {
		t.Fatalf("unexpected status: %q", got)
	}

	got = Resolve("{{request1.response.headers.X-Trace}}", variables, envVars, store)
	if got != "t123" {
		t.Fatalf("unexpected header: %q", got)
	}

	got = Resolve("{{request1.response.body.user.id}}", variables, envVars, store)
	if got != "123" {
		t.Fatalf("unexpected body json path: %q", got)
	}

	got = Resolve("{{request1.response.body}}", variables, envVars, store)
	if got != `{"user":{"id":123,"name":"alice"}}` {
		t.Fatalf("unexpected raw body: %q", got)
	}
}

func TestResolve_UnknownOrUnparseableLeftUnchanged(t *testing.T) {
	variables := map[string]string{}
	envVars := map[string]string{}
	store := map[string]map[string]interface{}{
		"request1": {
			"body": "not json",
		},
	}

	got := Resolve("{{does.not.exist}}", variables, envVars, store)
	if got != "{{does.not.exist}}" {
		t.Fatalf("unexpected resolve: %q", got)
	}

	got = Resolve("{{request1.response.body.user.id}}", variables, envVars, store)
	if got != "{{request1.response.body.user.id}}" {
		t.Fatalf("unexpected resolve: %q", got)
	}
}

// TestResolveResponseReferences_MatchesResolveForRequestPlaceholders locks in
// that the standalone ResolveResponseReferences function (used by CLI/MCP,
// which layer their own variable/secret/env resolution on top) resolves
// requestN.response.* placeholders identically to Resolve's own handling of
// the same placeholders, since both now share the responseReferenceValue
// helper.
func TestResolveResponseReferences_MatchesResolveForRequestPlaceholders(t *testing.T) {
	store := map[string]map[string]interface{}{
		"request1": {
			"status":  200,
			"headers": map[string]string{"X-Trace": "t123"},
			"body":    `{"user":{"id":123,"name":"alice"}}`,
		},
	}

	cases := []string{
		"{{request1.response.status}}",
		"{{request1.response.headers.X-Trace}}",
		"{{request1.response.body.user.id}}",
		"{{request1.response.body.user.missing}}",
		"{{request1.response.body}}",
		"{{request2.response.body}}",
	}
	for _, input := range cases {
		want := Resolve(input, nil, nil, store)
		got := ResolveResponseReferences(input, store)
		if got != want {
			t.Errorf("ResolveResponseReferences(%q) = %q, want %q (to match Resolve)", input, got, want)
		}
	}
}

// TestResolveResponseReferences_LeavesNonResponsePlaceholdersUntouched
// verifies ResolveResponseReferences never touches secrets, plain
// variables, or {{env.*}} placeholders — CLI/MCP need to run their own
// resolution pass for those, since (unlike Desktop's Resolve) CLI's bare
// {{key}} also falls back to an environment-profile variable.
func TestResolveResponseReferences_LeavesNonResponsePlaceholdersUntouched(t *testing.T) {
	store := map[string]map[string]interface{}{
		"request1": {"body": "resp-body"},
	}

	inputs := []string{
		"{{secret:apiKey}}",
		"{{token}}",
		"{{env.baseUrl}}",
		"{{variables.foo}}",
		"plain text, no placeholders",
	}
	for _, input := range inputs {
		if got := ResolveResponseReferences(input, store); got != input {
			t.Errorf("ResolveResponseReferences(%q) = %q, want unchanged", input, got)
		}
	}
}

func TestResolveResponseReferences_EmptyInputOrStoreIsNoop(t *testing.T) {
	if got := ResolveResponseReferences("", map[string]map[string]interface{}{"request1": {"body": "x"}}); got != "" {
		t.Fatalf("expected empty input unchanged, got %q", got)
	}
	input := "{{request1.response.body}}"
	if got := ResolveResponseReferences(input, nil); got != input {
		t.Fatalf("expected nil store to leave placeholder untouched, got %q", got)
	}
	if got := ResolveResponseReferences(input, map[string]map[string]interface{}{}); got != input {
		t.Fatalf("expected empty store to leave placeholder untouched, got %q", got)
	}
}
