package app

import (
	"net/http"
	"testing"
)

// TestServiceSecretEndpoints exercises the core secret-management route
// family: list -> save -> get -> delete, plus vault-info shape. Uses a
// keyring-disabled, temp-dir-backed vault so tests never touch the host
// keychain (see newAppWithTestVault).
func TestServiceSecretEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, newAppWithTestVault(t))

	// Empty vault to start with.
	secrets := mustDecodeJSON[map[string][]string](t, postJSONTo(t, server.URL, "/v1/list-secrets", map[string]any{}))
	if len(secrets) != 0 {
		t.Fatalf("list-secrets=%+v, want empty vault", secrets)
	}

	resp := postJSONTo(t, server.URL, "/v1/save-secret", map[string]any{"env": "dev", "key": "apiKey", "value": "shh"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save-secret status=%d, want 200", resp.StatusCode)
	}
	saved := mustDecodeJSON[map[string][]string](t, resp)
	if keys := saved["dev"]; len(keys) != 1 || keys[0] != "apiKey" {
		t.Fatalf("save-secret result=%+v, want dev:[apiKey]", saved)
	}

	resp = postJSONTo(t, server.URL, "/v1/get-secret-value", map[string]any{"env": "dev", "key": "apiKey"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get-secret-value status=%d, want 200", resp.StatusCode)
	}
	if got := readBody(t, resp); got != "shh" {
		t.Fatalf("get-secret-value body=%q, want shh", got)
	}

	info := mustDecodeJSON[VaultInfo](t, postJSONTo(t, server.URL, "/v1/get-vault-info", map[string]any{}))
	if info.SecretCount != 1 || info.EnvCount != 1 {
		t.Fatalf("get-vault-info=%+v, want 1 secret in 1 env", info)
	}

	resp = postJSONTo(t, server.URL, "/v1/delete-secret", map[string]any{"env": "dev", "key": "apiKey"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete-secret status=%d, want 200", resp.StatusCode)
	}
	afterDelete := mustDecodeJSON[map[string][]string](t, resp)
	if len(afterDelete["dev"]) != 0 {
		t.Fatalf("delete-secret result=%+v, want dev empty", afterDelete)
	}

	// Unknown secret errors surface as 500 with the underlying message.
	resp = postJSONTo(t, server.URL, "/v1/get-secret-value", map[string]any{"env": "dev", "key": "missing"})
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("get-secret-value(missing) status=%d, want 500", resp.StatusCode)
	}
}

// TestServiceMasterPasswordEndpoints locks in the master-password lifecycle
// contract: has -> set -> verify (success/failure), each as boolean JSON or
// 204/error responses.
func TestServiceMasterPasswordEndpoints(t *testing.T) {
	_, server := newTestServiceServer(t, newAppWithTestVault(t))

	has := mustDecodeJSON[map[string]bool](t, postJSONTo(t, server.URL, "/v1/has-master-password", map[string]any{}))
	if has["result"] {
		t.Fatalf("has-master-password=%+v, want false before set", has)
	}

	resp := postJSONTo(t, server.URL, "/v1/set-master-password", map[string]any{"password": "correct-horse"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set-master-password status=%d, want 204", resp.StatusCode)
	}

	has = mustDecodeJSON[map[string]bool](t, postJSONTo(t, server.URL, "/v1/has-master-password", map[string]any{}))
	if !has["result"] {
		t.Fatalf("has-master-password=%+v, want true after set", has)
	}

	verify := mustDecodeJSON[map[string]bool](t, postJSONTo(t, server.URL, "/v1/verify-master-password", map[string]any{"password": "correct-horse"}))
	if !verify["result"] {
		t.Fatalf("verify-master-password(correct)=%+v, want true", verify)
	}

	verify = mustDecodeJSON[map[string]bool](t, postJSONTo(t, server.URL, "/v1/verify-master-password", map[string]any{"password": "wrong"}))
	if verify["result"] {
		t.Fatalf("verify-master-password(wrong)=%+v, want false", verify)
	}
}

// TestServiceResetVaultAndExportSecrets locks in the reset/export shapes.
func TestServiceResetVaultAndExportSecrets(t *testing.T) {
	_, server := newTestServiceServer(t, newAppWithTestVault(t))

	postJSONTo(t, server.URL, "/v1/save-secret", map[string]any{"env": "dev", "key": "k1", "value": "v1"})

	exported := mustDecodeJSON[map[string]map[string]string](t, postJSONTo(t, server.URL, "/v1/export-secrets", map[string]any{}))
	if exported["dev"]["k1"] != "v1" {
		t.Fatalf("export-secrets=%+v, want dev.k1=v1", exported)
	}

	resp := postJSONTo(t, server.URL, "/v1/reset-vault", map[string]any{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reset-vault status=%d, want 200", resp.StatusCode)
	}
	reset := mustDecodeJSON[map[string][]string](t, resp)
	if len(reset) != 0 {
		t.Fatalf("reset-vault=%+v, want empty map", reset)
	}

	afterReset := mustDecodeJSON[map[string][]string](t, postJSONTo(t, server.URL, "/v1/list-secrets", map[string]any{}))
	if len(afterReset) != 0 {
		t.Fatalf("list-secrets after reset=%+v, want empty", afterReset)
	}
}

// TestServiceSecretEndpoints_MethodAndDecodeErrors characterizes the shared
// method/error-handling contract for the secret-management route family.
func TestServiceSecretEndpoints_MethodAndDecodeErrors(t *testing.T) {
	_, server := newTestServiceServer(t, newAppWithTestVault(t))

	paths := []string{
		"/v1/list-secrets",
		"/v1/save-secret",
		"/v1/delete-secret",
		"/v1/get-secret-value",
		"/v1/get-vault-info",
		"/v1/has-master-password",
		"/v1/set-master-password",
		"/v1/verify-master-password",
		"/v1/reset-vault",
		"/v1/export-secrets",
	}

	for _, path := range paths {
		t.Run(path+"/GET", func(t *testing.T) {
			resp := requestTo(t, http.MethodGet, server.URL, path, "")
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("status=%d, want 405", resp.StatusCode)
			}
		})
		t.Run(path+"/bad-json", func(t *testing.T) {
			resp := postRawTo(t, server.URL, path, []byte("nope"))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status=%d, want 400", resp.StatusCode)
			}
		})
	}
}
