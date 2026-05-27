package app

import (
	"os"
	"path/filepath"

	"rawrequest/internal/secretvaultlogic"

	"github.com/gen2brain/beeep"
)

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

func (a *App) HasMasterPassword() (bool, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return false, err
	}
	return vault.HasMasterPassword(), nil
}

func (a *App) SetMasterPassword(password string) error {
	vault, err := a.getSecretVault()
	if err != nil {
		return err
	}
	return vault.SetMasterPassword(password)
}

func (a *App) VerifyMasterPassword(password string) (bool, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return false, err
	}
	return vault.VerifyMasterPassword(password)
}

// SendNotification sends an OS-level notification.
func (a *App) SendNotification(title, message string) error {
	// On macOS, use native Notification Center so the notification uses the app icon.
	if err := notifyNative(title, message); err == nil {
		return nil
	}
	return beeep.Notify(title, message, "")
}

func (a *App) GetEnterpriseConfig() (*secretvaultlogic.EnterpriseConfig, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return nil, err
	}
	return vault.GetEnterpriseConfig()
}

func (a *App) SaveEnterpriseConfig(cfg *secretvaultlogic.EnterpriseConfig) error {
	vault, err := a.getSecretVault()
	if err != nil {
		return err
	}
	return vault.SaveEnterpriseConfig(cfg)
}

func (a *App) TestEnterpriseSecret(key string) (string, error) {
	vault, err := a.getSecretVault()
	if err != nil {
		return "", err
	}
	return vault.TestEnterpriseSecret(key)
}

func (a *App) OpenEnterpriseConfig() error {
	vault, err := a.getSecretVault()
	if err != nil {
		return err
	}
	configPath := filepath.Join(vault.dir, "secrets-config.json")
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		cfg := secretvaultlogic.DefaultConfig()
		if err := secretvaultlogic.SaveConfig(vault.dir, cfg); err != nil {
			return err
		}
	}
	return a.RevealInFinder(configPath)
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
