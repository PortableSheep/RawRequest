package migrations

import (
	"context"
	"fmt"
	"time"
)

// Logger receives best-effort progress messages from the runner.
// Implementations should be safe for concurrent use.
type Logger interface {
	Logf(format string, args ...any)
}

type nopLogger struct{}

func (nopLogger) Logf(string, ...any) {}

// RunPending runs all migrations in r that aren't yet recorded as applied
// in the ledger at ledgerPath. Migrations are run in lexicographic ID
// order. Successful migrations are persisted to the ledger immediately;
// failed migrations are NOT recorded, so they will be retried on the
// next run.
//
// RunPending is best-effort: a single migration's failure is logged and
// the runner continues with the next migration. The returned error
// reports problems persisting the ledger itself, which callers may want
// to surface.
func RunPending(ctx context.Context, r *Registry, ledgerPath string, log Logger) error {
	if r == nil {
		return nil
	}
	if log == nil {
		log = nopLogger{}
	}

	ledger, err := LoadLedger(ledgerPath)
	if err != nil {
		// Log + continue. A corrupt ledger should not prevent migrations
		// from being retried; the worst case is re-running an
		// already-applied (idempotent) migration.
		log.Logf("migrations: ledger load warning: %v", err)
	}

	for _, m := range r.Ordered() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if ledger.HasApplied(m.ID) {
			continue
		}
		log.Logf("migrations: applying %s (%s)", m.ID, m.Description)
		if err := safeApply(ctx, m); err != nil {
			log.Logf("migrations: %s failed (will retry next launch): %v", m.ID, err)
			continue
		}
		ledger.MarkApplied(m.ID, time.Now().UTC())
		if err := SaveLedger(ledgerPath, ledger); err != nil {
			// Migration applied but ledger could not be persisted; the
			// migration will re-run next launch (idempotent), so this is
			// recoverable. Surface the error for diagnostics.
			return fmt.Errorf("persist ledger after %s: %w", m.ID, err)
		}
		log.Logf("migrations: %s applied", m.ID)
	}
	return nil
}

// safeApply runs the migration, converting panics into errors so a buggy
// migration cannot crash the host process.
func safeApply(ctx context.Context, m Migration) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in migration %s: %v", m.ID, r)
		}
	}()
	return m.Apply(ctx)
}
