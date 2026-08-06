// Package cancelregistry owns the concurrency-safe bookkeeping of in-flight
// request cancellation functions that was previously held directly as
// fields on internal/app.App (requestCancels/cancelMutex). It has no
// dependency on Wails and exposes a small, explicit lifecycle API so it can
// be unit- and race-tested in isolation from the rest of the application.
package cancelregistry

import (
	"context"
	"sync"
)

// Registry maps request IDs to the context.CancelFunc that aborts the
// in-flight work registered for that ID. All methods are safe for
// concurrent use.
type Registry struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

// New creates an empty Registry.
func New() *Registry {
	return &Registry{cancels: make(map[string]context.CancelFunc)}
}

// Register records cancel as the way to abort the in-flight work identified
// by id. It is a no-op if id is empty or cancel is nil. Registering the
// same id again replaces the previous entry without invoking it, matching
// the historical map-assignment behavior.
func (r *Registry) Register(id string, cancel context.CancelFunc) {
	if id == "" || cancel == nil {
		return
	}
	r.mu.Lock()
	r.cancels[id] = cancel
	r.mu.Unlock()
}

// Clear removes id from the registry without invoking its cancel func. Use
// this once the associated work has finished on its own (success or error)
// so a later Cancel call for a reused/stale id becomes a no-op instead of
// cancelling unrelated work. It is a no-op if id is empty or not present.
func (r *Registry) Clear(id string) {
	if id == "" {
		return
	}
	r.mu.Lock()
	delete(r.cancels, id)
	r.mu.Unlock()
}

// Cancel invokes and removes the cancel func registered for id, if any, and
// reports whether one was found. It is safe to call for an empty or
// unknown id (no-op, returns false) — cancellation is fire-and-forget.
func (r *Registry) Cancel(id string) bool {
	if id == "" {
		return false
	}
	r.mu.Lock()
	cancel, ok := r.cancels[id]
	if ok {
		delete(r.cancels, id)
	}
	r.mu.Unlock()

	if ok {
		cancel()
	}
	return ok
}

// Track derives a cancellable context from parent, registers it under id,
// and returns the context together with a release func. Callers should
// unconditionally defer release(): it cancels the derived context (a no-op
// if it was already cancelled via Cancel) and removes id from the
// registry, guaranteeing cleanup on every exit path — success, error, or
// external cancellation — with a single line at the call site.
func (r *Registry) Track(parent context.Context, id string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	r.Register(id, cancel)
	return ctx, func() {
		cancel()
		r.Clear(id)
	}
}

// Len reports the number of currently tracked IDs. Intended for tests and
// diagnostics.
func (r *Registry) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.cancels)
}
