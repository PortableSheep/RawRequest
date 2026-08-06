package migrations

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// LedgerEntry records when a migration was applied.
type LedgerEntry struct {
	AppliedAt time.Time `json:"appliedAt"`
}

// Ledger is a serializable record of which migrations have been applied.
type Ledger struct {
	Applied map[string]LedgerEntry `json:"applied"`
}

// LedgerFileName is the filename used inside the app config dir.
const LedgerFileName = "migrations.json"

// LoadLedger reads a ledger from path. A missing file returns an empty
// ledger and no error. A corrupt file returns an empty ledger and a
// non-nil error so the caller can decide whether to log/quarantine the
// existing file before continuing.
func LoadLedger(path string) (*Ledger, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return &Ledger{Applied: make(map[string]LedgerEntry)}, nil
		}
		return &Ledger{Applied: make(map[string]LedgerEntry)}, err
	}
	if len(data) == 0 {
		return &Ledger{Applied: make(map[string]LedgerEntry)}, nil
	}
	var l Ledger
	if err := json.Unmarshal(data, &l); err != nil {
		return &Ledger{Applied: make(map[string]LedgerEntry)}, fmt.Errorf("corrupt migrations ledger: %w", err)
	}
	if l.Applied == nil {
		l.Applied = make(map[string]LedgerEntry)
	}
	return &l, nil
}

// SaveLedger atomically writes the ledger to path. Parent directories are
// created if needed.
func SaveLedger(path string, l *Ledger) error {
	if l == nil {
		return errors.New("nil ledger")
	}
	if l.Applied == nil {
		l.Applied = make(map[string]LedgerEntry)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create ledger dir: %w", err)
	}

	data, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal ledger: %w", err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".migrations.*.tmp")
	if err != nil {
		return fmt.Errorf("create temp ledger: %w", err)
	}
	tmpPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp ledger: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("sync temp ledger: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp ledger: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		cleanup()
		return fmt.Errorf("rename ledger: %w", err)
	}
	return nil
}

// MarkApplied records that id was applied at now.
func (l *Ledger) MarkApplied(id string, now time.Time) {
	if l.Applied == nil {
		l.Applied = make(map[string]LedgerEntry)
	}
	l.Applied[id] = LedgerEntry{AppliedAt: now}
}

// HasApplied reports whether id is in the ledger.
func (l *Ledger) HasApplied(id string) bool {
	if l == nil || l.Applied == nil {
		return false
	}
	_, ok := l.Applied[id]
	return ok
}
