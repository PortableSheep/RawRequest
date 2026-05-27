package secretvaultlogic

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// EnterpriseConfig holds settings for enterprise secrets vault providers.
type EnterpriseConfig struct {
	Comment              string        `json:"_comment,omitempty"`
	Provider             string        `json:"provider"`      // "local", "1password", "doppler", "aws", "vault", "custom"
	CustomCommandComment string        `json:"_customCommandComment,omitempty"`
	CustomCommand        string        `json:"customCommand"` // Custom CLI command template e.g. "op read {{key}}"
	AWS                  AWSConfig     `json:"aws"`
	Doppler              DopplerConfig `json:"doppler"`
	Vault                VaultConfig   `json:"vault"`
}

type AWSConfig struct {
	Comment string `json:"_comment,omitempty"`
	Region  string `json:"region"`
	Profile string `json:"profile"`
}

type DopplerConfig struct {
	Comment string `json:"_comment,omitempty"`
	Project string `json:"project"`
	Config  string `json:"config"`
}

type VaultConfig struct {
	Comment string `json:"_comment,omitempty"`
	Address string `json:"address"`
	Token   string `json:"token"`
}

// DefaultConfig returns a local-only enterprise config with embedded helper comments.
func DefaultConfig() *EnterpriseConfig {
	return &EnterpriseConfig{
		Comment:              "RawRequest Enterprise Secrets Configuration. Active provider can be: local, 1password, doppler, aws, vault, custom.",
		Provider:             "local",
		CustomCommandComment: "Custom CLI command template. Uses {{key}} token, e.g. 'gcloud secrets versions access latest --secret=\"{{key}}\"'",
		AWS: AWSConfig{
			Comment: "AWS Secrets Manager settings. Profile and Region overrides.",
		},
		Doppler: DopplerConfig{
			Comment: "Doppler settings. Default fallback Project and Config.",
		},
		Vault: VaultConfig{
			Comment: "HashiCorp Vault settings. VAULT_ADDR and VAULT_TOKEN overrides.",
		},
	}
}

// LoadConfig loads the enterprise config from secrets directory.
func LoadConfig(dir string) (*EnterpriseConfig, error) {
	path := filepath.Join(dir, "secrets-config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfig(), nil
		}
		return nil, err
	}
	var cfg EnterpriseConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveConfig saves the enterprise config to secrets directory.
func SaveConfig(dir string, cfg *EnterpriseConfig) error {
	path := filepath.Join(dir, "secrets-config.json")
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

// ResolveSecret resolves a secret key using either explicit scheme auto-detection or the default provider.
func ResolveSecret(key string, config *EnterpriseConfig) (string, error) {
	// 1. Detect explicit schemes
	if strings.HasPrefix(key, "op://") {
		return resolve1Password(key, &config.AWS) // AWSConfig region is not used but signature matching
	}
	if strings.HasPrefix(key, "doppler://") {
		return resolveDoppler(key, &config.Doppler)
	}
	if strings.HasPrefix(key, "aws://") {
		return resolveAWS(key, &config.AWS)
	}
	if strings.HasPrefix(key, "vault://") {
		return resolveVault(key, &config.Vault)
	}
	if strings.HasPrefix(key, "custom://") {
		return resolveCustom(strings.TrimPrefix(key, "custom://"), config.CustomCommand)
	}

	// 2. Fall back to the configured provider if no scheme
	switch config.Provider {
	case "1password":
		// Format as op:// private/item/field if it's not a URI
		opKey := key
		if !strings.HasPrefix(opKey, "op://") {
			// If not a full URI, assume format op://vault/item/field
			opKey = "op://" + key
		}
		return resolve1Password(opKey, &config.AWS)
	case "doppler":
		return resolveDoppler(key, &config.Doppler)
	case "aws":
		return resolveAWS(key, &config.AWS)
	case "vault":
		return resolveVault(key, &config.Vault)
	case "custom":
		return resolveCustom(key, config.CustomCommand)
	default:
		return "", fmt.Errorf("provider 'local' cannot resolve key '%s' externally", key)
	}
}

// resolve1Password executes: op read <uri> --no-color
func resolve1Password(uri string, _ *AWSConfig) (string, error) {
	// op read op://vault/item/field --no-color
	return runCommand(30*time.Second, nil, "op", "read", uri, "--no-color")
}

// resolveDoppler executes: doppler secrets get <key> --plain
func resolveDoppler(key string, cfg *DopplerConfig) (string, error) {
	cleanKey := strings.TrimPrefix(key, "doppler://")
	
	// Doppler URI parsing: doppler://[project]/[config]/KEY
	project := cfg.Project
	config := cfg.Config
	if strings.Contains(cleanKey, "/") {
		parts := strings.Split(cleanKey, "/")
		if len(parts) >= 3 {
			project = parts[0]
			config = parts[1]
			cleanKey = strings.Join(parts[2:], "/")
		} else if len(parts) == 2 {
			config = parts[0]
			cleanKey = parts[1]
		}
	}

	args := []string{"secrets", "get", cleanKey, "--plain"}
	if project != "" {
		args = append(args, "--project", project)
	}
	if config != "" {
		args = append(args, "--config", config)
	}

	return runCommand(30*time.Second, nil, "doppler", args...)
}

// resolveAWS executes: aws secretsmanager get-secret-value --secret-id <secret_id>
func resolveAWS(key string, cfg *AWSConfig) (string, error) {
	cleanKey := strings.TrimPrefix(key, "aws://")
	
	// aws://secret_id/json_key
	secretID := cleanKey
	jsonKey := ""
	if strings.Contains(cleanKey, "/") {
		parts := strings.SplitN(cleanKey, "/", 2)
		secretID = parts[0]
		jsonKey = parts[1]
	}

	args := []string{"secretsmanager", "get-secret-value", "--secret-id", secretID, "--query", "SecretString", "--output", "text"}
	if cfg.Region != "" {
		args = append(args, "--region", cfg.Region)
	}
	if cfg.Profile != "" {
		args = append(args, "--profile", cfg.Profile)
	}

	output, err := runCommand(30*time.Second, nil, "aws", args...)
	if err != nil {
		return "", err
	}

	if jsonKey == "" {
		return output, nil
	}

	// Attempt to extract jsonKey from the fetched secret value JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(output), &parsed); err != nil {
		return "", fmt.Errorf("aws secret is not valid JSON, cannot extract key '%s': %w", jsonKey, err)
	}

	val, exists := parsed[jsonKey]
	if !exists {
		return "", fmt.Errorf("key '%s' not found in aws secret '%s'", jsonKey, secretID)
	}

	return fmt.Sprintf("%v", val), nil
}

// resolveVault executes: vault kv get -field=<field> <path>
func resolveVault(key string, cfg *VaultConfig) (string, error) {
	cleanKey := strings.TrimPrefix(key, "vault://")

	// vault://path:field or vault://secret/data/path:field
	path := cleanKey
	field := ""
	if strings.Contains(cleanKey, ":") {
		parts := strings.SplitN(cleanKey, ":", 2)
		path = parts[0]
		field = parts[1]
	}

	args := []string{"kv", "get"}
	if field != "" {
		args = append(args, fmt.Sprintf("-field=%s", field))
	}
	args = append(args, path)

	env := os.Environ()
	if cfg.Address != "" {
		env = append(env, "VAULT_ADDR="+cfg.Address)
	}
	if cfg.Token != "" {
		env = append(env, "VAULT_TOKEN="+cfg.Token)
	}

	return runCommand(30*time.Second, env, "vault", args...)
}

// resolveCustom runs a user-defined shell CLI template replacing {{key}}
func resolveCustom(key string, template string) (string, error) {
	if template == "" {
		return "", errors.New("custom command template is empty")
	}

	replaced := strings.ReplaceAll(template, "{{key}}", key)
	args := splitCommand(replaced)
	if len(args) == 0 {
		return "", errors.New("invalid custom command template")
	}

	return runCommand(30*time.Second, nil, args[0], args[1:]...)
}

// runCommand runs a command with timeout and returns standard output stripped of whitespace.
func runCommand(timeout time.Duration, env []string, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if env != nil {
		cmd.Env = env
	}

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		stderrStr := strings.TrimSpace(stderr.String())
		if stderrStr != "" {
			return "", fmt.Errorf("command %s failed: %w (stderr: %s)", name, err, stderrStr)
		}
		return "", fmt.Errorf("command %s failed: %w", name, err)
	}

	return strings.TrimSpace(stdout.String()), nil
}

// splitCommand splits a command line string into a list of arguments safely supporting quotes.
func splitCommand(cmdStr string) []string {
	var args []string
	var current strings.Builder
	inDoubleQuotes := false
	inSingleQuotes := false
	escaped := false

	for i := 0; i < len(cmdStr); i++ {
		r := cmdStr[i]
		if escaped {
			current.WriteByte(r)
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == '"' && !inSingleQuotes {
			inDoubleQuotes = !inDoubleQuotes
			continue
		}
		if r == '\'' && !inDoubleQuotes {
			inSingleQuotes = !inSingleQuotes
			continue
		}
		if (r == ' ' || r == '\t' || r == '\r' || r == '\n') && !inDoubleQuotes && !inSingleQuotes {
			if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		} else {
			current.WriteByte(r)
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}
