//go:build darwin

package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeExe(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshCLIBinary_ReplacesSymlink(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src", "rawrequest")
	writeExe(t, src, "NEW")

	bundleBin := filepath.Join(tmp, "RawRequest.app", "Contents", "MacOS", "RawRequest")
	writeExe(t, bundleBin, "BUNDLE")

	link := filepath.Join(tmp, "bin", "rawrequest")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(bundleBin, link); err != nil {
		t.Fatal(err)
	}

	refreshCLIBinary(link, src)

	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatalf("lstat: %v", err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("expected symlink to be replaced with a regular file")
	}
	got, err := os.ReadFile(link)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "NEW" {
		t.Fatalf("expected NEW contents, got %q", string(got))
	}
	if fi.Mode().Perm() != 0o755 {
		t.Fatalf("expected mode 0755, got %v", fi.Mode().Perm())
	}
}

func TestRefreshCLIBinary_RefreshesRegularFile(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src", "rawrequest")
	writeExe(t, src, "NEW")

	dst := filepath.Join(tmp, "bin", "rawrequest")
	writeExe(t, dst, "OLD")

	refreshCLIBinary(dst, src)

	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "NEW" {
		t.Fatalf("expected refreshed contents NEW, got %q", string(got))
	}
}

func TestRefreshCLIBinary_LeavesForeignSymlinkAlone(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src", "rawrequest")
	writeExe(t, src, "NEW")

	// User-managed target outside any .app bundle.
	userTarget := filepath.Join(tmp, "dev", "rawrequest")
	writeExe(t, userTarget, "USER")

	link := filepath.Join(tmp, "bin", "rawrequest")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(userTarget, link); err != nil {
		t.Fatal(err)
	}

	refreshCLIBinary(link, src)

	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("foreign symlink should not have been replaced")
	}
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != userTarget {
		t.Fatalf("symlink target changed: got %q, want %q", got, userTarget)
	}
}

func TestRefreshCLIBinary_MissingTargetIsNoop(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src", "rawrequest")
	writeExe(t, src, "NEW")

	missing := filepath.Join(tmp, "bin", "rawrequest")
	refreshCLIBinary(missing, src)

	if _, err := os.Lstat(missing); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expected missing path to remain missing, got err=%v", err)
	}
}

func TestInstallRealFile_AtomicReplace(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "rawrequest.new")
	writeExe(t, src, "payload")
	dst := filepath.Join(tmp, "rawrequest")
	writeExe(t, dst, "old")

	if err := installRealFile(dst, src); err != nil {
		t.Fatalf("installRealFile: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "payload" {
		t.Fatalf("got %q, want payload", string(got))
	}

	entries, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".rawrequest.cli.") {
			t.Fatalf("temp file leaked: %s", e.Name())
		}
	}
}

func TestFindStandaloneCLIInStaging(t *testing.T) {
	tmp := t.TempDir()
	standalone := filepath.Join(tmp, "rawrequest")
	writeExe(t, standalone, "cli")
	inside := filepath.Join(tmp, "RawRequest.app", "Contents", "MacOS", "rawrequest")
	writeExe(t, inside, "bundled")

	got := findStandaloneCLIInStaging(tmp)
	if got != standalone {
		t.Fatalf("got %q, want %q", got, standalone)
	}
}

func TestFindStandaloneCLIInStaging_Empty(t *testing.T) {
	if got := findStandaloneCLIInStaging(""); got != "" {
		t.Fatalf("expected empty result for empty stagingDir, got %q", got)
	}
	if got := findStandaloneCLIInStaging(t.TempDir()); got != "" {
		t.Fatalf("expected empty result for empty dir, got %q", got)
	}
}

func TestRefreshCLICopyBestEffort_NonAppPath(t *testing.T) {
	refreshCLICopyBestEffort("/some/plain/directory", "")
}

func TestOSAQuote(t *testing.T) {
	cases := map[string]string{
		"/tmp/foo":   "'/tmp/foo'",
		"/tmp/it's": `'/tmp/it'\''s'`,
		"":           "''",
	}
	for in, want := range cases {
		if got := osaQuote(in); got != want {
			t.Errorf("osaQuote(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsPermissionDenied(t *testing.T) {
	if !isPermissionDenied(fs.ErrPermission) {
		t.Fatal("expected fs.ErrPermission to be permission-denied")
	}
	wrapped := &os.PathError{Op: "open", Path: "/x", Err: fs.ErrPermission}
	if !isPermissionDenied(wrapped) {
		t.Fatal("expected wrapped fs.ErrPermission to be permission-denied")
	}
	if isPermissionDenied(errors.New("nope")) {
		t.Fatal("plain error should not be permission-denied")
	}
	if isPermissionDenied(nil) {
		t.Fatal("nil should not be permission-denied")
	}
}
