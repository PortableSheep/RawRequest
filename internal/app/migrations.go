package app

import (
	"context"
	"fmt"
	"path/filepath"

	"rawrequest/internal/migrations"
)

// migrationsLogger adapts the App's diagnostics logger to the
// migrations.Logger interface so migration progress is captured in the
// existing diagnostics.log without leaking through the normal script-log
// UI.
type migrationsLogger struct {
	a *App
}

func (l migrationsLogger) Logf(format string, args ...any) {
	if l.a == nil {
		return
	}
	l.a.RecordDiagnosticLog("INFO", fmt.Sprintf(format, args...))
}

// runStartupMigrations runs idempotent install-state repairs registered
// with migrations.Default. It is best-effort: failures are recorded in
// the diagnostics log but never block startup or surface to the user.
func (a *App) runStartupMigrations(ctx context.Context) {
	ledgerPath := filepath.Join(a.getAppDir(), migrations.LedgerFileName)
	if err := migrations.RunPending(ctx, migrations.Default, ledgerPath, migrationsLogger{a: a}); err != nil {
		a.RecordDiagnosticLog("WARN", fmt.Sprintf("migrations runner: %v", err))
	}
}
