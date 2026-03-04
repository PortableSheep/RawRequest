//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepairCLISymlink_FixesBroken(t *testing.T) {
	tmp := t.TempDir()

	// Simulate the binary inside a new .app bundle.
	binary := filepath.Join(tmp, "RawRequest.app", "Contents", "MacOS", "RawRequest")
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create a broken symlink (target doesn't exist).
	linkPath := filepath.Join(tmp, "rawrequest")
	if err := os.Symlink("/no/such/path/RawRequest", linkPath); err != nil {
		t.Fatal(err)
	}

	repairCLISymlink(linkPath, binary)

	got, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("readlink after repair: %v", err)
	}
	if got != binary {
		t.Fatalf("expected symlink to point to %s, got %s", binary, got)
	}
}

func TestRepairCLISymlink_FixesBackup(t *testing.T) {
	tmp := t.TempDir()

	// Simulate old backup binary that still exists.
	oldBinary := filepath.Join(tmp, "RawRequest.app.bak-20260101T000000Z", "Contents", "MacOS", "RawRequest")
	if err := os.MkdirAll(filepath.Dir(oldBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldBinary, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Simulate the new binary.
	newBinary := filepath.Join(tmp, "RawRequest.app", "Contents", "MacOS", "RawRequest")
	if err := os.MkdirAll(filepath.Dir(newBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newBinary, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Symlink pointing at the old backup (still resolves, but stale).
	linkPath := filepath.Join(tmp, "rawrequest")
	if err := os.Symlink(oldBinary, linkPath); err != nil {
		t.Fatal(err)
	}

	repairCLISymlink(linkPath, newBinary)

	got, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("readlink after repair: %v", err)
	}
	if got != newBinary {
		t.Fatalf("expected symlink to point to %s, got %s", newBinary, got)
	}
}

func TestRepairCLISymlink_LeavesCorrectAlone(t *testing.T) {
	tmp := t.TempDir()

	binary := filepath.Join(tmp, "RawRequest.app", "Contents", "MacOS", "RawRequest")
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}

	linkPath := filepath.Join(tmp, "rawrequest")
	if err := os.Symlink(binary, linkPath); err != nil {
		t.Fatal(err)
	}

	repairCLISymlink(linkPath, binary)

	got, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("readlink: %v", err)
	}
	if got != binary {
		t.Fatalf("expected %s, got %s", binary, got)
	}
}

func TestRepairCLISymlink_SkipsNonSymlink(t *testing.T) {
	tmp := t.TempDir()

	// Regular file, not a symlink.
	filePath := filepath.Join(tmp, "rawrequest")
	if err := os.WriteFile(filePath, []byte("regular"), 0o755); err != nil {
		t.Fatal(err)
	}

	repairCLISymlink(filePath, "/some/target")

	// File should remain a regular file, untouched.
	fi, err := os.Lstat(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("regular file was turned into a symlink")
	}
}

func TestRepairCLISymlink_SkipsNonexistent(t *testing.T) {
	// Should not panic or error on missing path.
	repairCLISymlink(filepath.Join(t.TempDir(), "nope"), "/some/target")
}

func TestRefreshCLICopyBestEffort_NonAppPath(t *testing.T) {
	// Should be a no-op for non-.app paths.
	refreshCLICopyBestEffort("/some/plain/directory")
}
