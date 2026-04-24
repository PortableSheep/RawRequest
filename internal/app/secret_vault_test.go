package app

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSecretVaultReset_RemovesMasterHash verifies that Reset() clears the
// master-password hash file along with the other vault artifacts, so the
// forgot-password flow truly starts from scratch.
func TestSecretVaultReset_RemovesMasterHash(t *testing.T) {
	dir := t.TempDir()
	sv, err := NewSecretVault(dir)
	if err != nil {
		t.Fatalf("NewSecretVault: %v", err)
	}
	// Disable keyring interaction during tests to avoid touching the host keychain.
	sv.keyringService = ""
	sv.keyringUser = ""

	// Seed files the Reset() call is expected to remove.
	files := map[string][]byte{
		sv.dataPath:              []byte("ciphertext"),
		sv.keyPath:               []byte("key"),
		sv.masterPasswordPath():  []byte("bcrypt-hash"),
	}
	for path, data := range files {
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("seed %s: %v", filepath.Base(path), err)
		}
	}

	if err := sv.Reset(); err != nil {
		t.Fatalf("Reset: %v", err)
	}

	for path := range files {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, stat err=%v", filepath.Base(path), err)
		}
	}

	if sv.HasMasterPassword() {
		t.Fatalf("HasMasterPassword should be false after reset")
	}
}
