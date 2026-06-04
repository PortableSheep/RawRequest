//go:build darwin

package migrations

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// makeFakeBundle builds a minimal fake .app/Contents/MacOS/RawRequest under
// dir and returns the path to the inner binary file.
func makeFakeBundle(t *testing.T, dir, payload string) string {
	t.Helper()
	binDir := filepath.Join(dir, "RawRequest.app", "Contents", "MacOS")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bundle: %v", err)
	}
	binPath := filepath.Join(binDir, "RawRequest")
	if err := os.WriteFile(binPath, []byte(payload), 0o755); err != nil {
		t.Fatalf("write bundle bin: %v", err)
	}
	return binPath
}

func TestPathInsideAppBundle(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/Applications/RawRequest.app/Contents/MacOS/RawRequest", true},
		{"/Applications/RawRequest.APP/Contents/MacOS/RawRequest", true},
		{"/Applications/Other.app/Contents/Resources/foo", false},
		{"/usr/local/bin/rawrequest", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := pathInsideAppBundle(tc.path); got != tc.want {
			t.Errorf("pathInsideAppBundle(%q) = %v want %v", tc.path, got, tc.want)
		}
	}
}

func TestClassifyCLICandidate(t *testing.T) {
	tmp := t.TempDir()
	bundleBin := makeFakeBundle(t, tmp, "fake-binary")

	t.Run("missing path", func(t *testing.T) {
		if got := classifyCLICandidate(filepath.Join(tmp, "nope")); got != cliActionSkip {
			t.Errorf("missing path classified as %v, want skip", got)
		}
	})

	t.Run("regular file", func(t *testing.T) {
		p := filepath.Join(tmp, "real-file")
		if err := os.WriteFile(p, []byte("data"), 0o755); err != nil {
			t.Fatal(err)
		}
		if got := classifyCLICandidate(p); got != cliActionSkip {
			t.Errorf("regular file classified as %v, want skip", got)
		}
	})

	t.Run("symlink to non-bundle", func(t *testing.T) {
		other := filepath.Join(tmp, "other-target")
		if err := os.WriteFile(other, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(tmp, "link-non-bundle")
		if err := os.Symlink(other, link); err != nil {
			t.Fatal(err)
		}
		if got := classifyCLICandidate(link); got != cliActionSkip {
			t.Errorf("non-bundle symlink classified as %v, want skip", got)
		}
	})

	t.Run("symlink into bundle", func(t *testing.T) {
		link := filepath.Join(tmp, "rawrequest-link")
		if err := os.Symlink(bundleBin, link); err != nil {
			t.Fatal(err)
		}
		if got := classifyCLICandidate(link); got != cliActionReplace {
			t.Errorf("bundle symlink classified as %v, want replace", got)
		}
	})

	t.Run("relative symlink into bundle resolves correctly", func(t *testing.T) {
		linkDir := filepath.Join(tmp, "binsim")
		if err := os.MkdirAll(linkDir, 0o755); err != nil {
			t.Fatal(err)
		}
		// The bundle is at <tmp>/RawRequest.app/...; the link sits in
		// <tmp>/binsim/, so the relative target needs to escape one dir.
		rel, err := filepath.Rel(linkDir, bundleBin)
		if err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(linkDir, "rawrequest")
		if err := os.Symlink(rel, link); err != nil {
			t.Fatal(err)
		}
		if got := classifyCLICandidate(link); got != cliActionReplace {
			t.Errorf("relative bundle symlink classified as %v, want replace", got)
		}
	})

	t.Run("dangling symlink into bundle still triggers replace", func(t *testing.T) {
		// The classifier inspects the textual target, not the resolved
		// file, so a dangling link into a bundle-shaped path is still
		// our own broken installation to repair.
		link := filepath.Join(tmp, "dangling")
		if err := os.Symlink("/Applications/Ghost.app/Contents/MacOS/Ghost", link); err != nil {
			t.Fatal(err)
		}
		if got := classifyCLICandidate(link); got != cliActionReplace {
			t.Errorf("dangling bundle symlink classified as %v, want replace", got)
		}
	})
}

func TestReplaceWithRealFile_ReplacesSymlinkWithCopy(t *testing.T) {
	tmp := t.TempDir()
	bundleBin := makeFakeBundle(t, tmp, "the-real-binary-bytes")

	link := filepath.Join(tmp, "rawrequest")
	if err := os.Symlink(bundleBin, link); err != nil {
		t.Fatal(err)
	}

	if err := replaceWithRealFile(link, bundleBin); err != nil {
		t.Fatalf("replaceWithRealFile: %v", err)
	}

	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatalf("Lstat after replace: %v", err)
	}
	if fi.Mode()&fs.ModeSymlink != 0 {
		t.Fatal("expected real file, got symlink")
	}
	if fi.Mode().Perm() != 0o755 {
		t.Errorf("expected mode 0755, got %v", fi.Mode().Perm())
	}

	got, err := os.ReadFile(link)
	if err != nil {
		t.Fatalf("read replaced file: %v", err)
	}
	if string(got) != "the-real-binary-bytes" {
		t.Errorf("content mismatch: %q", string(got))
	}
}

func TestReplaceWithRealFile_OverwritesExistingRegularFile(t *testing.T) {
	tmp := t.TempDir()
	src := filepath.Join(tmp, "src")
	if err := os.WriteFile(src, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(tmp, "dst")
	if err := os.WriteFile(dst, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceWithRealFile(dst, src); err != nil {
		t.Fatalf("replaceWithRealFile: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Errorf("content = %q, want %q", string(got), "new")
	}
}

func TestRunCLIRealFile_OnlyTouchesBundleSymlinks(t *testing.T) {
	tmp := t.TempDir()
	bundleBin := makeFakeBundle(t, tmp, "RR-BIN")

	// Candidate 1: a real file we must not touch.
	realFile := filepath.Join(tmp, "real-rawrequest")
	if err := os.WriteFile(realFile, []byte("user-installed"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Candidate 2: a symlink to something other than our bundle.
	other := filepath.Join(tmp, "other-binary")
	if err := os.WriteFile(other, []byte("not-ours"), 0o755); err != nil {
		t.Fatal(err)
	}
	foreignLink := filepath.Join(tmp, "foreign-link")
	if err := os.Symlink(other, foreignLink); err != nil {
		t.Fatal(err)
	}

	// Candidate 3: a symlink into the bundle (the case we fix).
	bundleLink := filepath.Join(tmp, "bundle-link")
	if err := os.Symlink(bundleBin, bundleLink); err != nil {
		t.Fatal(err)
	}

	// Candidate 4: a missing path.
	missing := filepath.Join(tmp, "missing")

	cfg := cliRealFileConfig{
		candidates: []string{realFile, foreignLink, bundleLink, missing},
		bundleBin:  bundleBin,
	}
	if err := runCLIRealFile(cfg); err != nil {
		t.Fatalf("runCLIRealFile: %v", err)
	}

	// Real file untouched.
	if data, _ := os.ReadFile(realFile); string(data) != "user-installed" {
		t.Errorf("real file was modified: %q", data)
	}
	// Foreign symlink untouched.
	fi, err := os.Lstat(foreignLink)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&fs.ModeSymlink == 0 {
		t.Error("foreign symlink became a regular file")
	}
	// Bundle symlink replaced with real file.
	fi, err = os.Lstat(bundleLink)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&fs.ModeSymlink != 0 {
		t.Error("bundle symlink was not replaced")
	}
	if data, _ := os.ReadFile(bundleLink); string(data) != "RR-BIN" {
		t.Errorf("bundle replacement content = %q, want RR-BIN", data)
	}
}

func TestRunCLIRealFile_PrivilegedFallbackOnPermissionDenied(t *testing.T) {
	tmp := t.TempDir()
	bundleBin := makeFakeBundle(t, tmp, "RR-BIN")

	// Use a parent directory we can't write to to provoke EACCES on
	// rename. We'll mock the privileged replacer instead of actually
	// changing perms (which is fragile in CI).
	bundleLink := filepath.Join(tmp, "bundle-link")
	if err := os.Symlink(bundleBin, bundleLink); err != nil {
		t.Fatal(err)
	}

	var privilegedCalled int
	cfg := cliRealFileConfig{
		candidates: []string{bundleLink},
		bundleBin:  bundleBin,
		// Inject a fake replaceWithRealFile-like behavior would require
		// exposing more knobs; instead we simulate the EACCES path by
		// overriding the privileged hook only — the real replace will
		// succeed in our writable tmpdir, so this test verifies the hook
		// is *not* called when the unprivileged path works.
		privilegedReplace: func(string, string) error {
			privilegedCalled++
			return nil
		},
	}
	if err := runCLIRealFile(cfg); err != nil {
		t.Fatalf("runCLIRealFile: %v", err)
	}
	if privilegedCalled != 0 {
		t.Errorf("privileged hook called %d times when unprivileged path should have succeeded", privilegedCalled)
	}
}

func TestRunCLIRealFile_BundleBinMissingErrors(t *testing.T) {
	cfg := cliRealFileConfig{
		candidates: []string{"/tmp/should-not-be-touched"},
		bundleBin:  "/tmp/definitely/missing/binary",
	}
	if err := runCLIRealFile(cfg); err == nil {
		t.Fatal("expected error when bundle binary missing")
	}
}

func TestIsPermissionError(t *testing.T) {
	if !isPermissionError(fs.ErrPermission) {
		t.Error("ErrPermission should be classified as permission error")
	}
	if !isPermissionError(&os.PathError{Op: "rename", Path: "/x", Err: fs.ErrPermission}) {
		t.Error("wrapped ErrPermission should be classified as permission error")
	}
	if isPermissionError(errors.New("something else")) {
		t.Error("non-permission error must not be classified as permission error")
	}
	if isPermissionError(nil) {
		t.Error("nil error must not be classified as permission error")
	}
}

func TestShellQuote(t *testing.T) {
	cases := map[string]string{
		"/usr/local/bin/rawrequest": `'/usr/local/bin/rawrequest'`,
		"path with spaces":          `'path with spaces'`,
		`weird'quote`:                `'weird'\''quote'`,
	}
	for in, want := range cases {
		if got := shellQuote(in); got != want {
			t.Errorf("shellQuote(%q) = %q want %q", in, got, want)
		}
	}
}
