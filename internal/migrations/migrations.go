// Package migrations runs idempotent, one-shot install-state repairs that
// must execute on the first launch after upgrading the binary.
//
// A migration is identified by an opaque, lexicographically ordered ID
// (e.g. "0001_cli_real_file"). The runner persists the set of applied
// IDs in a ledger file inside the app's config directory. Migrations
// that succeed are recorded; migrations that report an error are NOT
// recorded, so they will be retried on the next launch.
//
// Migrations must be:
//   - Idempotent: safe to re-run without effect when nothing needs changing.
//   - Best-effort: returning a nil error when a no-op was correct.
//   - Side-effect contained: never block app startup; the runner is
//     intended to be called from a goroutine.
package migrations

import (
	"context"
	"errors"
	"sort"
	"sync"
)

// Migration is a single repair step.
//
// Apply must be idempotent and should return nil when the migration was
// either successfully applied or not needed. Returning a non-nil error
// causes the runner to skip persisting the ID, so the migration will be
// retried on the next launch.
type Migration struct {
	ID          string
	Description string
	Apply       func(context.Context) error
}

// Registry holds a set of migrations by ID. The zero value is ready to use.
type Registry struct {
	mu  sync.Mutex
	all map[string]Migration
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{all: make(map[string]Migration)}
}

// Register adds a migration. Registering the same ID twice returns an error;
// callers typically panic in init() to surface programming mistakes.
func (r *Registry) Register(m Migration) error {
	if m.ID == "" {
		return errors.New("migration ID cannot be empty")
	}
	if m.Apply == nil {
		return errors.New("migration Apply function cannot be nil")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.all == nil {
		r.all = make(map[string]Migration)
	}
	if _, exists := r.all[m.ID]; exists {
		return errors.New("migration already registered: " + m.ID)
	}
	r.all[m.ID] = m
	return nil
}

// MustRegister registers a migration and panics on error. Intended for
// package init() use.
func (r *Registry) MustRegister(m Migration) {
	if err := r.Register(m); err != nil {
		panic("migrations: " + err.Error())
	}
}

// Ordered returns all registered migrations sorted by ID.
func (r *Registry) Ordered() []Migration {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Migration, 0, len(r.all))
	for _, m := range r.all {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Default is the process-wide registry. Migrations declared in their own
// build-tagged files register themselves here at init time.
var Default = NewRegistry()
