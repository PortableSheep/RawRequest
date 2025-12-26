package main

import (
	"os"
	"path/filepath"

	"github.com/gen2brain/beeep"
)

// Secret management API -----------------------------------------------------

func (a *App) ListSecrets() (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.ListSecrets()
}

func (a *App) SaveSecret(env, key, value string) (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.StoreSecret(env, key, value)
}

func (a *App) DeleteSecret(env, key string) (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.RemoveSecret(env, key)
}

func (a *App) GetSecretValue(env, key string) (string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return "", err
	}
	return vault.GetSecret(env, key)
}

func (a *App) GetVaultInfo() (*VaultInfo, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.Info()
}

func (a *App) ResetVault() (map[string][]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	if err := vault.Reset(); err != nil {
		return nil, err
	}
	return map[string][]string{}, nil
}

func (a *App) ExportSecrets() (map[string]map[string]string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.Export()
}

// SendNotification sends an OS-level notification.
func (a *App) SendNotification(title, message string) error {
	// On macOS, use native Notification Center so the notification uses the app icon.
	if err := notifyNative(title, message); err == nil {
		return nil
	}
	return beeep.Notify(title, message, "")
}

func (a *App) getSecretVault() (*SecretVault, error) {
	a.secretVaultOnce.Do(func() {
		configDir, err := os.UserConfigDir()
		if err != nil || configDir == "" {
			configDir = os.TempDir()
		}
		appDir := filepath.Join(configDir, "rawrequest", "secrets")
		vault, err := NewSecretVault(appDir)
		if err != nil {
			a.secretVaultErr = err
			return
		}
		a.secretVault = vault
	})
	return a.secretVault, a.secretVaultErr
}
