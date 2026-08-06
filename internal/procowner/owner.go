// Package procowner owns the concurrency-safe PID bookkeeping for a single
// externally-managed subprocess (the local service process App spawns via
// EnsureServiceRunning) that was previously held directly as fields on
// internal/app.App (managedServicePID/managedServiceMu). It has no
// dependency on Wails and exposes a small, explicit lifecycle API so process
// ownership can be unit- and race-tested in isolation from the rest of the
// application.
package procowner

import (
	"os"
	"sync"
)

// Owner tracks the PID of a single owned subprocess. All methods are safe
// for concurrent use.
type Owner struct {
	mu  sync.Mutex
	pid int
}

// New creates an Owner tracking no process (PID 0).
func New() *Owner {
	return &Owner{}
}

// Set records pid as the currently owned process, replacing any previous
// value without affecting the OS process it may have referred to.
func (o *Owner) Set(pid int) {
	o.mu.Lock()
	o.pid = pid
	o.mu.Unlock()
}

// Get returns the currently tracked PID (0 if none owned). Intended for
// tests and diagnostics.
func (o *Owner) Get() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.pid
}

// ClearIfMatch clears the tracked PID only if it currently equals pid, and
// reports whether it cleared. This guards a process-exit watcher goroutine
// against clearing a PID that has since been replaced by a newer owned
// process (e.g. the previous process was stopped and a new one started
// before the old one's Wait() returned).
func (o *Owner) ClearIfMatch(pid int) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.pid == pid {
		o.pid = 0
		return true
	}
	return false
}

// Stop clears the tracked PID (regardless of its value) and, if one was
// set, best-effort kills the corresponding OS process. Errors from
// FindProcess or Kill are swallowed: shutdown must not fail merely because
// the process already exited on its own, matching prior App behavior.
func (o *Owner) Stop() error {
	o.mu.Lock()
	pid := o.pid
	o.pid = 0
	o.mu.Unlock()

	if pid <= 0 {
		return nil
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}
	_ = proc.Kill()
	return nil
}
