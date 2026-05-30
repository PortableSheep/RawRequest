package secretvaultlogic

import (
	"os"
	"reflect"
	"testing"
	"time"
)

func TestSplitCommand(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{
			input:    `op read op://vault/item/field`,
			expected: []string{"op", "read", "op://vault/item/field"},
		},
		{
			input:    `aws secretsmanager get-secret-value --secret-id "my secret"`,
			expected: []string{"aws", "secretsmanager", "get-secret-value", "--secret-id", "my secret"},
		},
		{
			input:    `custom-cli --key 'some-single-quoted-value' --flag`,
			expected: []string{"custom-cli", "--key", "some-single-quoted-value", "--flag"},
		},
		{
			input:    `sh -c "echo \"hello world\""`,
			expected: []string{"sh", "-c", `echo "hello world"`},
		},
		{
			input:    `   multiple   spaces  \t and \n newlines   `,
			expected: []string{"multiple", "spaces", "t", "and", "n", "newlines"},
		},
	}

	for _, tc := range tests {
		got := splitCommand(tc.input)
		if !reflect.DeepEqual(got, tc.expected) {
			t.Errorf("splitCommand(%q) = %v; expected %v", tc.input, got, tc.expected)
		}
	}
}

func TestConfigLoadSave(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "secrets-config-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg, err := LoadConfig(tempDir)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.Provider != "local" {
		t.Errorf("expected provider local, got %q", cfg.Provider)
	}

	cfg.Provider = "1password"
	cfg.CustomCommand = "op read {{key}}"
	cfg.AWS.Region = "us-west-2"
	cfg.Doppler.Project = "my-proj"
	cfg.Vault.Address = "http://127.0.0.1:8200"

	if err := SaveConfig(tempDir, cfg); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	reloaded, err := LoadConfig(tempDir)
	if err != nil {
		t.Fatalf("LoadConfig reloaded failed: %v", err)
	}

	if reloaded.Provider != "1password" || reloaded.AWS.Region != "us-west-2" || reloaded.Doppler.Project != "my-proj" || reloaded.Vault.Address != "http://127.0.0.1:8200" {
		t.Errorf("config mismatch after reload: %+v", reloaded)
	}
}

func TestResolveSecret_ProviderCommands(t *testing.T) {
	original := commandRunner
	t.Cleanup(func() { commandRunner = original })

	type invocation struct {
		name string
		args []string
		env  []string
	}

	var calls []invocation
	commandRunner = func(_ time.Duration, env []string, name string, args ...string) (string, error) {
		calls = append(calls, invocation{name: name, args: append([]string(nil), args...), env: append([]string(nil), env...)})
		if name == "aws" {
			return `{"token":"aws-value"}`, nil
		}
		return "resolved-value", nil
	}

	cfg := &EnterpriseConfig{
		Provider:      "custom",
		CustomCommand: "echo custom-{{key}}",
		AWS: AWSConfig{
			Region:  "us-west-2",
			Profile: "dev-profile",
		},
		Doppler: DopplerConfig{
			Project: "fallback-project",
			Config:  "fallback-config",
		},
		Vault: VaultConfig{
			Address: "http://127.0.0.1:8200",
			Token:   "vault-token",
		},
	}

	tests := []struct {
		name     string
		key      string
		expected string
	}{
		{name: "1password URI", key: "op://vault/item/field", expected: "resolved-value"},
		{name: "doppler URI", key: "doppler://project/config/API_KEY", expected: "resolved-value"},
		{name: "aws URI", key: "aws://service/token", expected: "aws-value"},
		{name: "vault URI", key: "vault://secret/data/app:token", expected: "resolved-value"},
		{name: "custom URI", key: "custom://runtime-key", expected: "resolved-value"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := len(calls)
			got, err := ResolveSecret(tc.key, cfg)
			if err != nil {
				t.Fatalf("ResolveSecret(%q): %v", tc.key, err)
			}
			if got != tc.expected {
				t.Fatalf("ResolveSecret(%q) = %q", tc.key, got)
			}

			call := calls[before]
			switch tc.name {
			case "1password URI":
				if call.name != "op" || !reflect.DeepEqual(call.args, []string{"read", "op://vault/item/field", "--no-color"}) {
					t.Fatalf("unexpected op invocation: %#v", call)
				}
			case "doppler URI":
				expectedArgs := []string{"secrets", "get", "API_KEY", "--plain", "--project", "project", "--config", "config"}
				if call.name != "doppler" || !reflect.DeepEqual(call.args, expectedArgs) {
					t.Fatalf("unexpected doppler invocation: %#v", call)
				}
			case "aws URI":
				expectedArgs := []string{"secretsmanager", "get-secret-value", "--secret-id", "service", "--query", "SecretString", "--output", "text", "--region", "us-west-2", "--profile", "dev-profile"}
				if call.name != "aws" || !reflect.DeepEqual(call.args, expectedArgs) {
					t.Fatalf("unexpected aws invocation: %#v", call)
				}
			case "vault URI":
				expectedArgs := []string{"kv", "get", "-field=token", "secret/data/app"}
				if call.name != "vault" || !reflect.DeepEqual(call.args, expectedArgs) {
					t.Fatalf("unexpected vault invocation: %#v", call)
				}
				if !containsAll(call.env, "VAULT_ADDR=http://127.0.0.1:8200", "VAULT_TOKEN=vault-token") {
					t.Fatalf("unexpected vault env: %#v", call.env)
				}
			case "custom URI":
				if call.name != "echo" || !reflect.DeepEqual(call.args, []string{"custom-runtime-key"}) {
					t.Fatalf("unexpected custom invocation: %#v", call)
				}
			}
		})
	}
}

func TestResolveSecret_DefaultProviderCommands(t *testing.T) {
	original := commandRunner
	t.Cleanup(func() { commandRunner = original })

	var calls []struct {
		name string
		args []string
	}
	commandRunner = func(_ time.Duration, _ []string, name string, args ...string) (string, error) {
		calls = append(calls, struct {
			name string
			args []string
		}{name: name, args: append([]string(nil), args...)})
		return "resolved-value", nil
	}

	tests := []struct {
		name     string
		config   *EnterpriseConfig
		key      string
		cmd      string
		expected []string
	}{
		{
			name:     "1password default",
			config:   &EnterpriseConfig{Provider: "1password"},
			key:      "team/item/field",
			cmd:      "op",
			expected: []string{"read", "op://team/item/field", "--no-color"},
		},
		{
			name:     "doppler default",
			config:   &EnterpriseConfig{Provider: "doppler", Doppler: DopplerConfig{Project: "project", Config: "dev"}},
			key:      "API_KEY",
			cmd:      "doppler",
			expected: []string{"secrets", "get", "API_KEY", "--plain", "--project", "project", "--config", "dev"},
		},
		{
			name:     "custom default",
			config:   &EnterpriseConfig{Provider: "custom", CustomCommand: "echo local-{{key}}"},
			key:      "token",
			cmd:      "echo",
			expected: []string{"local-token"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := len(calls)
			got, err := ResolveSecret(tc.key, tc.config)
			if err != nil {
				t.Fatalf("ResolveSecret(%q): %v", tc.key, err)
			}
			if got != "resolved-value" {
				t.Fatalf("ResolveSecret(%q) = %q", tc.key, got)
			}
			call := calls[before]
			if call.name != tc.cmd || !reflect.DeepEqual(call.args, tc.expected) {
				t.Fatalf("unexpected invocation: %#v", call)
			}
		})
	}
}

func containsAll(values []string, expected ...string) bool {
	for _, want := range expected {
		found := false
		for _, got := range values {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
