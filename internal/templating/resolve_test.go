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
