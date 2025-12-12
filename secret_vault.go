package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	keyringServiceName = "rawrequest"
	keyringVaultUser   = "secrets-vault"
)

type VaultInfo struct {
	Directory   string `json:"directory"`
	KeyPath     string `json:"keyPath"`
	DataPath    string `json:"dataPath"`
	SecretCount int    `json:"secretCount"`
	EnvCount    int    `json:"envCount"`
	KeySource   string `json:"keySource"`
}

type SecretVault struct {
	dir            string
	keyPath        string
	dataPath       string
	key            []byte
	keySource      string
	mu             sync.Mutex
	keyringService string
	keyringUser    string
}

func NewSecretVault(dir string) (*SecretVault, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &SecretVault{
		dir:            dir,
		keyPath:        filepath.Join(dir, ".vault.key"),
		dataPath:       filepath.Join(dir, "secrets.vault.json"),
		keyringService: keyringServiceName,
		keyringUser:    keyringVaultUser,
	}, nil
}

func (sv *SecretVault) Export() (map[string]map[string]string, error) {
	sv.mu.Lock()
	defer sv.mu.Unlock()

	return sv.loadSecretsLocked()
}

func (sv *SecretVault) Reset() error {
	sv.mu.Lock()
	defer sv.mu.Unlock()

	_ = os.Remove(sv.dataPath)
	_ = os.Remove(sv.keyPath)
	if sv.keyringService != "" && sv.keyringUser != "" {
		_ = keyring.Delete(sv.keyringService, sv.keyringUser)
	}
	sv.key = nil
	sv.keySource = ""
	return nil
}

func (sv *SecretVault) Info() (*VaultInfo, error) {
	sv.mu.Lock()
	defer sv.mu.Unlock()

	secrets, err := sv.loadSecretsLocked()
	if err != nil {
		return nil, err
	}
	envCount := len(secrets)
	secretCount := 0
	for _, envSecrets := range secrets {
		secretCount += len(envSecrets)
	}
	source := sv.keySource
	if source == "" {
		source = "unknown"
	}
	return &VaultInfo{
		Directory:   sv.dir,
		KeyPath:     sv.keyPath,
		DataPath:    sv.dataPath,
		SecretCount: secretCount,
		EnvCount:    envCount,
		KeySource:   source,
	}, nil
}

func (sv *SecretVault) ListSecrets() (map[string][]string, error) {
	sv.mu.Lock()
	defer sv.mu.Unlock()

	secrets, err := sv.loadSecretsLocked()
	if err != nil {
		return nil, err
	}
	return snapshotSecretKeys(secrets), nil
}

func (sv *SecretVault) StoreSecret(env, key, value string) (map[string][]string, error) {
	env = normalizeSecretEnv(env)
	cleanedKey, err := normalizeSecretKey(key)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(value) == "" {
		return nil, errors.New("secret value cannot be empty")
	}

	sv.mu.Lock()
	defer sv.mu.Unlock()

	secrets, err := sv.loadSecretsLocked()
	if err != nil {
		return nil, err
	}
	if secrets[env] == nil {
		secrets[env] = make(map[string]string)
	}
	secrets[env][cleanedKey] = value

	if err := sv.saveSecretsLocked(secrets); err != nil {
		return nil, err
	}
	return snapshotSecretKeys(secrets), nil
}

func (sv *SecretVault) RemoveSecret(env, key string) (map[string][]string, error) {
	env = normalizeSecretEnv(env)
	cleanedKey, err := normalizeSecretKey(key)
	if err != nil {
		return nil, err
	}

	sv.mu.Lock()
	defer sv.mu.Unlock()

	secrets, err := sv.loadSecretsLocked()
	if err != nil {
		return nil, err
	}

	if entries, ok := secrets[env]; ok {
		delete(entries, cleanedKey)
		if len(entries) == 0 {
			delete(secrets, env)
		}
	}

	if err := sv.saveSecretsLocked(secrets); err != nil {
		return nil, err
	}
	return snapshotSecretKeys(secrets), nil
}

func (sv *SecretVault) GetSecret(env, key string) (string, error) {
	env = normalizeSecretEnv(env)
	cleanedKey, err := normalizeSecretKey(key)
	if err != nil {
		return "", err
	}

	sv.mu.Lock()
	defer sv.mu.Unlock()

	secrets, err := sv.loadSecretsLocked()
	if err != nil {
		return "", err
	}

	if envSecrets, ok := secrets[env]; ok {
		if value, exists := envSecrets[cleanedKey]; exists {
			return value, nil
		}
	}
	return "", fmt.Errorf("secret %s not found in %s", cleanedKey, env)
}

func (sv *SecretVault) loadSecretsLocked() (map[string]map[string]string, error) {
	data, err := os.ReadFile(sv.dataPath)
	if errors.Is(err, os.ErrNotExist) {
		return make(map[string]map[string]string), nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return make(map[string]map[string]string), nil
	}

	if err := sv.ensureKeyLocked(false); err != nil {
		return nil, err
	}
	if len(sv.key) == 0 {
		return nil, errors.New("vault key missing")
	}

	plaintext, err := sv.decrypt(data)
	if err != nil {
		return nil, err
	}

	var secrets map[string]map[string]string
	if err := json.Unmarshal(plaintext, &secrets); err != nil {
		return nil, err
	}
	if secrets == nil {
		secrets = make(map[string]map[string]string)
	}
	return secrets, nil
}

func (sv *SecretVault) saveSecretsLocked(secrets map[string]map[string]string) error {
	if secrets == nil {
		secrets = make(map[string]map[string]string)
	}
	if err := sv.ensureKeyLocked(true); err != nil {
		return err
	}

	plaintext, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	ciphertext, err := sv.encrypt(plaintext)
	if err != nil {
		return err
	}

	tempFile := sv.dataPath + ".tmp"
	if err := os.WriteFile(tempFile, ciphertext, 0o600); err != nil {
		return err
	}
	return os.Rename(tempFile, sv.dataPath)
}

func (sv *SecretVault) ensureKeyLocked(create bool) error {
	if len(sv.key) == 32 {
		return nil
	}
	if keyringBytes, err := sv.readKeyring(); err == nil {
		sv.key = keyringBytes
		sv.keySource = "keyring"
		return nil
	}
	data, err := os.ReadFile(sv.keyPath)
	if err == nil {
		decoded, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
		if decodeErr != nil {
			return decodeErr
		}
		if len(decoded) != 32 {
			return errors.New("vault key has invalid length")
		}
		sv.key = decoded
		sv.keySource = "file"
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if !create {
		return nil
	}

	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return err
	}
	encoded := base64.StdEncoding.EncodeToString(keyBytes)
	if err := sv.writeKeyring(encoded); err == nil {
		sv.keySource = "keyring"
	}
	if err := os.WriteFile(sv.keyPath, []byte(encoded), 0o600); err != nil {
		return err
	}
	sv.key = keyBytes
	if sv.keySource == "" {
		sv.keySource = "file"
	}
	return nil
}

func (sv *SecretVault) readKeyring() ([]byte, error) {
	if sv.keyringService == "" || sv.keyringUser == "" {
		return nil, errors.New("keyring disabled")
	}
	value, err := keyring.Get(sv.keyringService, sv.keyringUser)
	if err != nil {
		return nil, err
	}
	decoded, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	if decodeErr != nil {
		return nil, decodeErr
	}
	if len(decoded) != 32 {
		return nil, errors.New("invalid key length from keyring")
	}
	return decoded, nil
}

func (sv *SecretVault) writeKeyring(value string) error {
	if sv.keyringService == "" || sv.keyringUser == "" {
		return errors.New("keyring disabled")
	}
	return keyring.Set(sv.keyringService, sv.keyringUser, value)
}

func (sv *SecretVault) encrypt(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(sv.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

func (sv *SecretVault) decrypt(ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(sv.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}
	nonce := ciphertext[:nonceSize]
	payload := ciphertext[nonceSize:]
	return gcm.Open(nil, nonce, payload, nil)
}

func normalizeSecretEnv(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "default"
	}
	return trimmed
}

func normalizeSecretKey(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("secret key cannot be empty")
	}
	return trimmed, nil
}

func snapshotSecretKeys(secrets map[string]map[string]string) map[string][]string {
	result := make(map[string][]string)
	for env, entries := range secrets {
		keys := make([]string, 0, len(entries))
		for key := range entries {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		result[env] = keys
	}
	return result
}
