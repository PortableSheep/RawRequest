package app

import (
	"net/http"
	"testing"
)

// TestServiceVariableEndpoints locks in the global variable get/set contract:
// set-variable returns 204 and the value is then observable via get-variable
// as a plain-text response.
func TestServiceVariableEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	resp := postJSONTo(t, server.URL, "/v1/set-variable", map[string]any{"key": "token", "value": "abc123"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set-variable status=%d, want 204", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/get-variable", map[string]any{"key": "token"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get-variable status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "abc123" {
		t.Fatalf("get-variable body=%q, want abc123", got)
	}

	// Unknown key contract: empty string, still 200.
	resp = postJSONTo(t, server.URL, "/v1/get-variable", map[string]any{"key": "missing"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get-variable(missing) status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "" {
		t.Fatalf("get-variable(missing) body=%q, want empty", got)
	}
}

// TestServiceEnvironmentEndpoints exercises the environment-management route
// family end to end: creating an environment via add-env-variable inside a
// selected environment, reading it back, renaming it, and confirming the
// aggregate get-environments/get-variables views stay consistent.
func TestServiceEnvironmentEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	// Environments map starts empty until an env is created/used - the
	// "default" env name is only tracked in-memory until it's populated.
	envs := mustDecodeJSON[map[string]map[string]string](t, postJSONTo(t, server.URL, "/v1/get-environments", map[string]any{}))
	if len(envs) != 0 {
		t.Fatalf("get-environments=%+v, want empty before any environment is populated", envs)
	}

	resp := postJSONTo(t, server.URL, "/v1/set-environment", map[string]any{"env": "staging"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set-environment status=%d, want 204", resp.StatusCode)
	}

	resp = postJSONTo(t, server.URL, "/v1/set-env-variable", map[string]any{"key": "baseUrl", "value": "https://staging.example.com"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set-env-variable status=%d, want 204", resp.StatusCode)
	}

	vars := mustDecodeJSON[map[string]string](t, postJSONTo(t, server.URL, "/v1/get-env-variables", map[string]any{"env": "staging"}))
	if vars["baseUrl"] != "https://staging.example.com" {
		t.Fatalf("get-env-variables=%+v, want baseUrl set", vars)
	}

	// add-env-variable writes to the currently active environment (staging),
	// distinct from the global variables map exposed via get-variables.
	resp = postJSONTo(t, server.URL, "/v1/add-env-variable", map[string]any{"key": "apiKey", "value": "secret-ish"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("add-env-variable status=%d, want 204", resp.StatusCode)
	}

	vars = mustDecodeJSON[map[string]string](t, postJSONTo(t, server.URL, "/v1/get-env-variables", map[string]any{"env": "staging"}))
	if vars["apiKey"] != "secret-ish" {
		t.Fatalf("get-env-variables after add=%+v, want apiKey added to active environment", vars)
	}

	// get-variables reflects the global variables map (set via set-variable),
	// which is independent of per-environment variables.
	resp = postJSONTo(t, server.URL, "/v1/set-variable", map[string]any{"key": "globalToken", "value": "g1"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set-variable status=%d, want 204", resp.StatusCode)
	}
	current := mustDecodeJSON[map[string]string](t, postJSONTo(t, server.URL, "/v1/get-variables", map[string]any{}))
	if current["globalToken"] != "g1" {
		t.Fatalf("get-variables=%+v, want globalToken set", current)
	}
	if _, ok := current["apiKey"]; ok {
		t.Fatalf("get-variables=%+v, want apiKey (env-scoped) absent from global variables", current)
	}

	resp = postJSONTo(t, server.URL, "/v1/rename-environment", map[string]any{"oldName": "staging", "newName": "stage"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("rename-environment status=%d, want 204", resp.StatusCode)
	}

	envs = mustDecodeJSON[map[string]map[string]string](t, postJSONTo(t, server.URL, "/v1/get-environments", map[string]any{}))
	if _, ok := envs["staging"]; ok {
		t.Fatalf("get-environments=%+v, want staging renamed away", envs)
	}
	if _, ok := envs["stage"]; !ok {
		t.Fatalf("get-environments=%+v, want stage present after rename", envs)
	}
}

// TestServiceEnvironmentEndpoints_MethodAndDecodeErrors characterizes the
// shared error-handling contract for the environment/variable route family.
func TestServiceEnvironmentEndpoints_MethodAndDecodeErrors(t *testing.T) {
	_, server := newTestServiceServer(t, nil)

	paths := []string{
		"/v1/set-variable",
		"/v1/get-variable",
		"/v1/get-environments",
		"/v1/set-environment",
		"/v1/get-env-variables",
		"/v1/set-env-variable",
		"/v1/get-variables",
		"/v1/add-env-variable",
		"/v1/rename-environment",
	}

	for _, path := range paths {
		t.Run(path+"/GET", func(t *testing.T) {
			resp := requestTo(t, http.MethodGet, server.URL, path, "")
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d, want 405", resp.StatusCode)
			}
		})
		t.Run(path+"/bad-json", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte("{"))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400", resp.StatusCode)
			}
		})
	}

	// The no-payload endpoints reject unexpected fields (DisallowUnknownFields).
	for _, path := range []string{"/v1/get-environments", "/v1/get-variables"} {
		t.Run(path+"/unknown-field", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte(`{"unexpected":1}`))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400 for unknown field", resp.StatusCode)
			}
		})
	}
}
