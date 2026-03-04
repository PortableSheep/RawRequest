package main

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func createTarGzWithSymlink(t *testing.T, dest string) {
	t.Helper()
	f, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gw := gzip.NewWriter(f)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	// Directory
	_ = tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeDir,
		Name:     "App.app/Contents/MacOS/",
		Mode:     0o755,
	})

	// Regular file
	body := []byte("binary-content")
	_ = tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeReg,
		Name:     "App.app/Contents/MacOS/App",
		Mode:     0o755,
		Size:     int64(len(body)),
	})
	_, _ = tw.Write(body)

	// Relative symlink inside the bundle (safe)
	_ = tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeSymlink,
		Name:     "App.app/Contents/MacOS/app-cli",
		Linkname: "App",
	})

	// Absolute symlink (should be skipped for security)
	_ = tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeSymlink,
		Name:     "App.app/Contents/MacOS/evil",
		Linkname: "/etc/passwd",
	})

	// Relative symlink escaping root (should be skipped)
	_ = tw.WriteHeader(&tar.Header{
		Typeflag: tar.TypeSymlink,
		Name:     "App.app/Contents/MacOS/escape",
		Linkname: "../../../../etc/passwd",
	})
}

func TestExtractTarGz_PreservesRelativeSymlinks(t *testing.T) {
	tmp := t.TempDir()
	archive := filepath.Join(tmp, "test.tar.gz")
	createTarGzWithSymlink(t, archive)

	dest := filepath.Join(tmp, "extracted")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := extractTarGz(archive, dest); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// Regular file should exist.
	binaryPath := filepath.Join(dest, "App.app", "Contents", "MacOS", "App")
	if _, err := os.Stat(binaryPath); err != nil {
		t.Fatalf("expected binary to exist: %v", err)
	}

	// Safe relative symlink should exist and resolve.
	symlinkPath := filepath.Join(dest, "App.app", "Contents", "MacOS", "app-cli")
	fi, err := os.Lstat(symlinkPath)
	if err != nil {
		t.Fatalf("expected safe symlink to exist: %v", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("expected app-cli to be a symlink")
	}
	target, err := os.Readlink(symlinkPath)
	if err != nil {
		t.Fatal(err)
	}
	if target != "App" {
		t.Fatalf("expected symlink target 'App', got %q", target)
	}
	// Verify the symlink resolves to the actual binary.
	if _, err := os.Stat(symlinkPath); err != nil {
		t.Fatalf("safe symlink should resolve: %v", err)
	}

	// Absolute symlink should NOT exist (skipped for security).
	evilPath := filepath.Join(dest, "App.app", "Contents", "MacOS", "evil")
	if _, err := os.Lstat(evilPath); err == nil {
		t.Fatal("absolute symlink should have been skipped")
	}

	// Escaping symlink should NOT exist.
	escapePath := filepath.Join(dest, "App.app", "Contents", "MacOS", "escape")
	if _, err := os.Lstat(escapePath); err == nil {
		t.Fatal("escaping symlink should have been skipped")
	}
}
