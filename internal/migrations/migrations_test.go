package migrations

import (
	"context"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestRegistry_RegisterAndOrdered(t *testing.T) {
	r := NewRegistry()
	r.MustRegister(Migration{ID: "0002_b", Apply: func(context.Context) error { return nil }})
	r.MustRegister(Migration{ID: "0001_a", Apply: func(context.Context) error { return nil }})

	got := r.Ordered()
	if len(got) != 2 {
		t.Fatalf("got %d migrations, want 2", len(got))
	}
	if got[0].ID != "0001_a" || got[1].ID != "0002_b" {
		t.Fatalf("unexpected order: %v", []string{got[0].ID, got[1].ID})
	}
}

func TestRegistry_DuplicateRegistrationIsError(t *testing.T) {
	r := NewRegistry()
	noop := Migration{ID: "x", Apply: func(context.Context) error { return nil }}
	if err := r.Register(noop); err != nil {
		t.Fatalf("first register failed: %v", err)
	}
	if err := r.Register(noop); err == nil {
		t.Fatal("expected duplicate registration to error")
	}
}

func TestRegistry_RejectsEmptyIDOrNilApply(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(Migration{ID: "", Apply: func(context.Context) error { return nil }}); err == nil {
		t.Fatal("expected empty ID to error")
	}
	if err := r.Register(Migration{ID: "x"}); err == nil {
		t.Fatal("expected nil Apply to error")
	}
}

func TestRunPending_RunsOnlyUnapplied(t *testing.T) {
	r := NewRegistry()
	var ranA, ranB int32
	r.MustRegister(Migration{ID: "0001_a", Apply: func(context.Context) error { atomic.AddInt32(&ranA, 1); return nil }})
	r.MustRegister(Migration{ID: "0002_b", Apply: func(context.Context) error { atomic.AddInt32(&ranB, 1); return nil }})

	tmp := t.TempDir()
	ledgerPath := filepath.Join(tmp, LedgerFileName)

	if err := RunPending(context.Background(), r, ledgerPath, nil); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if atomic.LoadInt32(&ranA) != 1 || atomic.LoadInt32(&ranB) != 1 {
		t.Fatalf("expected each migration to run once, got ranA=%d ranB=%d", ranA, ranB)
	}

	// Second run should be a no-op since both are recorded.
	if err := RunPending(context.Background(), r, ledgerPath, nil); err != nil {
		t.Fatalf("second RunPending: %v", err)
	}
	if atomic.LoadInt32(&ranA) != 1 || atomic.LoadInt32(&ranB) != 1 {
		t.Fatalf("migrations re-ran on second pass: ranA=%d ranB=%d", ranA, ranB)
	}
}

func TestRunPending_FailureIsNotPersisted(t *testing.T) {
	r := NewRegistry()
	var attempts int32
	r.MustRegister(Migration{ID: "flaky", Apply: func(context.Context) error {
		atomic.AddInt32(&attempts, 1)
		return errors.New("boom")
	}})

	tmp := t.TempDir()
	ledgerPath := filepath.Join(tmp, LedgerFileName)

	if err := RunPending(context.Background(), r, ledgerPath, nil); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if err := RunPending(context.Background(), r, ledgerPath, nil); err != nil {
		t.Fatalf("RunPending second pass: %v", err)
	}
	if atomic.LoadInt32(&attempts) != 2 {
		t.Fatalf("expected 2 retry attempts, got %d", attempts)
	}

	led, err := LoadLedger(ledgerPath)
	if err != nil {
		t.Fatalf("LoadLedger: %v", err)
	}
	if led.HasApplied("flaky") {
		t.Fatal("failed migration must not be recorded as applied")
	}
}

func TestRunPending_SubsequentMigrationsRunWhenOneFails(t *testing.T) {
	r := NewRegistry()
	var ranLater int32
	r.MustRegister(Migration{ID: "0001_fail", Apply: func(context.Context) error { return errors.New("nope") }})
	r.MustRegister(Migration{ID: "0002_ok", Apply: func(context.Context) error { atomic.AddInt32(&ranLater, 1); return nil }})

	tmp := t.TempDir()
	if err := RunPending(context.Background(), r, filepath.Join(tmp, LedgerFileName), nil); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	if atomic.LoadInt32(&ranLater) != 1 {
		t.Fatal("later migration must still run when an earlier one fails")
	}
}

func TestRunPending_PanicInMigrationDoesNotCrash(t *testing.T) {
	r := NewRegistry()
	r.MustRegister(Migration{ID: "panic", Apply: func(context.Context) error {
		panic("intentional")
	}})

	tmp := t.TempDir()
	ledgerPath := filepath.Join(tmp, LedgerFileName)
	if err := RunPending(context.Background(), r, ledgerPath, nil); err != nil {
		t.Fatalf("RunPending: %v", err)
	}
	led, err := LoadLedger(ledgerPath)
	if err != nil {
		t.Fatalf("LoadLedger: %v", err)
	}
	if led.HasApplied("panic") {
		t.Fatal("panicking migration must not be recorded as applied")
	}
}

func TestRunPending_RespectsContextCancellation(t *testing.T) {
	r := NewRegistry()
	r.MustRegister(Migration{ID: "should_not_run", Apply: func(context.Context) error {
		t.Fatal("migration must not run when context is already cancelled")
		return nil
	}})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	tmp := t.TempDir()
	if err := RunPending(ctx, r, filepath.Join(tmp, LedgerFileName), nil); err == nil {
		t.Fatal("expected context.Canceled")
	}
}

func TestLedger_RoundTrip(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "sub", LedgerFileName)

	led, err := LoadLedger(path)
	if err != nil {
		t.Fatalf("LoadLedger missing: %v", err)
	}
	if len(led.Applied) != 0 {
		t.Fatalf("expected empty ledger, got %d entries", len(led.Applied))
	}

	now := time.Now().UTC().Truncate(time.Second)
	led.MarkApplied("0001_x", now)
	if err := SaveLedger(path, led); err != nil {
		t.Fatalf("SaveLedger: %v", err)
	}

	again, err := LoadLedger(path)
	if err != nil {
		t.Fatalf("LoadLedger: %v", err)
	}
	if !again.HasApplied("0001_x") {
		t.Fatal("expected 0001_x to be applied")
	}
	if !again.Applied["0001_x"].AppliedAt.Equal(now) {
		t.Fatalf("AppliedAt round-trip mismatch: got %v want %v", again.Applied["0001_x"].AppliedAt, now)
	}
}

func TestLedger_CorruptFileRecovers(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, LedgerFileName)
	if err := writeFile(path, []byte("{not json")); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	led, err := LoadLedger(path)
	if err == nil {
		t.Fatal("expected an error for corrupt ledger")
	}
	if led == nil || led.Applied == nil {
		t.Fatal("expected an empty ledger to be returned alongside the error")
	}
}

func TestLedger_EmptyFileTreatedAsEmpty(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, LedgerFileName)
	if err := writeFile(path, nil); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	led, err := LoadLedger(path)
	if err != nil {
		t.Fatalf("LoadLedger: %v", err)
	}
	if len(led.Applied) != 0 {
		t.Fatalf("expected empty applied set, got %d", len(led.Applied))
	}
}

func writeFile(path string, data []byte) error {
	return mkdirAndWrite(path, data)
}
