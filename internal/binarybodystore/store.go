// Package binarybodystore owns the concurrency-safe storage of raw binary
// response bodies that was previously held directly as fields on
// internal/app.App (binaryBodies/binaryBodiesMu). It has no dependency on
// Wails: callers use Put/Get/Delete to associate a request ID with its raw
// response bytes so a later "save to file" action can retrieve them, keeping
// this type unit- and race-testable in isolation from the rest of the
// application.
package binarybodystore

import "sync"

// Store is a concurrency-safe map from request ID to the raw bytes of that
// request's response body.
type Store struct {
	mu     sync.Mutex
	bodies map[string][]byte
}

// New creates an empty Store.
func New() *Store {
	return &Store{bodies: make(map[string][]byte)}
}

// Put stores body under requestID, replacing any previously stored body for
// the same ID. It is a no-op if requestID is empty.
func (s *Store) Put(requestID string, body []byte) {
	if requestID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies[requestID] = body
}

// Get returns the body stored for requestID and whether one was found. The
// returned slice is the same backing array that was stored via Put; callers
// that mutate it are responsible for copying first.
func (s *Store) Get(requestID string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, ok := s.bodies[requestID]
	return body, ok
}

// Delete removes the body stored for requestID, if any. It is a no-op if
// requestID is not present.
func (s *Store) Delete(requestID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.bodies, requestID)
}
