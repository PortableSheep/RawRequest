//go:build darwin

package migrations

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestShouldResignCLI(t *testing.T) {
	tmp := t.TempDir()

	regular := filepath.Join(tmp, "rawrequest")
	if err := os.WriteFile(regular, []byte("payload"), 0o755); err != nil {
		t.Fatal(err)
	}

	link := filepath.Join(tmp, "link")
	if err := os.Symlink(regular, link); err != nil {
		t.Fatal(err)
	}

	missing := filepath.Join(tmp, "nope")

	want := "dev.rawrequest.cli"

	cases := []struct {
		name      string
		path      string
		readIdent func(string) (string, error)
		expect    resignAction
	}{
		{"missing path is skipped", missing, func(string) (string, error) { return "", nil }, resignActionSkip},
		{"symlink is skipped", link, func(string) (string, error) { return "", nil }, resignActionSkip},
		{"already-correct identifier is skipped", regular, func(string) (string, error) { return want, nil }, resignActionSkip},
		{"different identifier triggers resign", regular, func(string) (string, error) { return "dev.rawrequest.app", nil }, resignActionResign},
		{"empty identifier triggers resign", regular, func(string) (string, error) { return "", nil }, resignActionResign},
		{"readIdent error triggers resign", regular, func(string) (string, error) { return "", errors.New("boom") }, resignActionResign},
		{"nil readIdent triggers resign", regular, nil, resignActionResign},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldResignCLI(tc.path, want, tc.readIdent)
			if got != tc.expect {
				t.Fatalf("shouldResignCLI = %v, want %v", got, tc.expect)
			}
		})
	}
}

func TestRunCLIDistinctIdentifier(t *testing.T) {
	tmp := t.TempDir()

	mkFile := func(name string) string {
		p := filepath.Join(tmp, name)
		if err := os.WriteFile(p, []byte("payload"), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}

	t.Run("resigns only candidates with mismatched identifier", func(t *testing.T) {
		needsResign := mkFile("needs-resign")
		alreadyOK := mkFile("already-ok")
		notHere := filepath.Join(tmp, "missing")

		idents := map[string]string{
			needsResign: "dev.rawrequest.app",
			alreadyOK:   "dev.rawrequest.cli",
		}
		var resigned []string
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{needsResign, alreadyOK, notHere},
			identifier: "dev.rawrequest.cli",
			codesign: func(path, ident string) error {
				if ident != "dev.rawrequest.cli" {
					t.Fatalf("codesign called with identifier %q", ident)
				}
				resigned = append(resigned, path)
				idents[path] = ident
				return nil
			},
			readIdent: func(path string) (string, error) {
				return idents[path], nil
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		sort.Strings(resigned)
		want := []string{needsResign}
		if !reflect.DeepEqual(resigned, want) {
			t.Fatalf("resigned = %v, want %v", resigned, want)
		}
	})

	t.Run("uses privileged path when file is not writable", func(t *testing.T) {
		readonly := mkFile("readonly")
		var unprivilegedCalls int
		var privilegedCalls []string
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{readonly},
			identifier: "dev.rawrequest.cli",
			canWrite:   func(string) bool { return false },
			codesign: func(string, string) error {
				unprivilegedCalls++
				return nil
			},
			privilegedCodesign: func(path, ident string) error {
				if ident != "dev.rawrequest.cli" {
					t.Fatalf("privileged called with identifier %q", ident)
				}
				privilegedCalls = append(privilegedCalls, path)
				return nil
			},
			readIdent: func(string) (string, error) { return "dev.rawrequest.app", nil },
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if unprivilegedCalls != 0 {
			t.Fatalf("unprivileged codesign should not be invoked when canWrite=false; calls=%d", unprivilegedCalls)
		}
		if !reflect.DeepEqual(privilegedCalls, []string{readonly}) {
			t.Fatalf("privilegedCalls = %v, want %v", privilegedCalls, []string{readonly})
		}
	})

	t.Run("falls back to privileged path when unprivileged codesign fails", func(t *testing.T) {
		writable := mkFile("writable")
		var privilegedCalls []string
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{writable},
			identifier: "dev.rawrequest.cli",
			canWrite:   func(string) bool { return true },
			codesign: func(string, string) error {
				return errors.New("codesign opaque internal error")
			},
			privilegedCodesign: func(path, ident string) error {
				privilegedCalls = append(privilegedCalls, path)
				return nil
			},
			readIdent: func(string) (string, error) { return "dev.rawrequest.app", nil },
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !reflect.DeepEqual(privilegedCalls, []string{writable}) {
			t.Fatalf("privilegedCalls = %v, want %v", privilegedCalls, []string{writable})
		}
	})

	t.Run("reports failure when privileged path also fails", func(t *testing.T) {
		readonly := mkFile("readonly-fail")
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{readonly},
			identifier: "dev.rawrequest.cli",
			canWrite:   func(string) bool { return false },
			codesign:   func(string, string) error { return nil },
			privilegedCodesign: func(string, string) error {
				return errors.New("user cancelled admin prompt")
			},
			readIdent: func(string) (string, error) { return "", nil },
		})
		if err == nil {
			t.Fatal("expected error from failed privileged retry")
		}
		if !contains(err.Error(), "(privileged)") || !contains(err.Error(), "user cancelled") {
			t.Fatalf("error %q should mention privileged failure", err)
		}
	})

	t.Run("reports failure when not writable and no privileged fallback", func(t *testing.T) {
		readonly := mkFile("readonly-no-fallback")
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{readonly},
			identifier: "dev.rawrequest.cli",
			canWrite:   func(string) bool { return false },
			codesign:   func(string, string) error { return nil },
			readIdent:  func(string) (string, error) { return "", nil },
		})
		if err == nil {
			t.Fatal("expected error when file not writable and no privileged fallback")
		}
		if !contains(err.Error(), "not writable") {
			t.Fatalf("error %q should mention writability", err)
		}
	})

	t.Run("collects per-candidate failures and returns error", func(t *testing.T) {
		bad := mkFile("bad")
		good := mkFile("good")

		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{bad, good},
			identifier: "dev.rawrequest.cli",
			codesign: func(path, ident string) error {
				if path == bad {
					return errors.New("codesign exploded")
				}
				return nil
			},
			readIdent: func(string) (string, error) { return "", nil },
		})
		if err == nil {
			t.Fatal("expected error")
		}
		if !contains(err.Error(), bad) || !contains(err.Error(), "codesign exploded") {
			t.Fatalf("error %q missing path or message", err)
		}
		if contains(err.Error(), good) {
			t.Fatalf("error %q should not mention successful candidate", err)
		}
	})

	t.Run("rejects empty identifier", func(t *testing.T) {
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			identifier: "",
			codesign:   func(string, string) error { return nil },
		})
		if err == nil {
			t.Fatal("expected error for empty identifier")
		}
	})

	t.Run("rejects nil codesign", func(t *testing.T) {
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			identifier: "x",
			codesign:   nil,
		})
		if err == nil {
			t.Fatal("expected error for nil codesign")
		}
	})

	t.Run("idempotent when all candidates already match", func(t *testing.T) {
		a := mkFile("idem-a")
		b := mkFile("idem-b")
		var calls int
		err := runCLIDistinctIdentifier(cliDistinctIdentifierConfig{
			candidates: []string{a, b},
			identifier: "dev.rawrequest.cli",
			codesign: func(string, string) error {
				calls++
				return nil
			},
			readIdent: func(string) (string, error) { return "dev.rawrequest.cli", nil },
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if calls != 0 {
			t.Fatalf("codesign should not be called when identifier matches; calls=%d", calls)
		}
	})
}

func TestCanWriteFile(t *testing.T) {
	tmp := t.TempDir()

	writable := filepath.Join(tmp, "writable")
	if err := os.WriteFile(writable, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !canWriteFile(writable) {
		t.Errorf("canWriteFile(writable) = false, want true")
	}

	readonly := filepath.Join(tmp, "readonly")
	if err := os.WriteFile(readonly, []byte("x"), 0o400); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(readonly, 0o644) })
	if canWriteFile(readonly) {
		t.Errorf("canWriteFile(readonly mode 0400) = true, want false")
	}

	missing := filepath.Join(tmp, "missing")
	if canWriteFile(missing) {
		t.Errorf("canWriteFile(missing) = true, want false")
	}
}

func TestMigrationCLIDistinctIdentifier_Registered(t *testing.T) {
	found := false
	for _, m := range Default.Ordered() {
		if m.ID == MigrationCLIDistinctIdentifier {
			found = true
			if m.Apply == nil {
				t.Fatal("registered migration has nil Apply")
			}
			if m.Description == "" {
				t.Fatal("registered migration has empty Description")
			}
		}
	}
	if !found {
		t.Fatalf("migration %s not registered in Default registry", MigrationCLIDistinctIdentifier)
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
