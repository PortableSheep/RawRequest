// Package variablestore owns the concurrency-safe storage for global
// variables and per-environment variables that were previously held
// directly as fields on internal/app.App. It has no dependency on Wails
// and exposes a small, explicit API so it can be unit tested in isolation
// from the rest of the application.
package variablestore

import (
	"maps"
	"sync"

	vj "rawrequest/internal/varsjson"
)

// DefaultEnvironment is the environment name new stores start with, matching
// the App's historical default.
const DefaultEnvironment = "default"

// Store holds global variables and per-environment variables behind
// independent read/write locks, mirroring the locking granularity the
// previous App fields used (a lock for global variables, a separate lock
// for environments/currentEnv).
type Store struct {
	variablesMu sync.RWMutex
	variables   map[string]string

	envMu        sync.RWMutex
	environments map[string]map[string]string
	currentEnv   string
}

// New creates a Store with empty global variables, no environments, and the
// default current environment name.
func New() *Store {
	return &Store{
		variables:    make(map[string]string),
		environments: make(map[string]map[string]string),
		currentEnv:   DefaultEnvironment,
	}
}

// SetVariable sets a global variable.
func (s *Store) SetVariable(key, value string) {
	s.variablesMu.Lock()
	s.variables[key] = value
	s.variablesMu.Unlock()
}

// GetVariable returns a global variable's value, or "" if unset.
func (s *Store) GetVariable(key string) string {
	s.variablesMu.RLock()
	defer s.variablesMu.RUnlock()
	return s.variables[key]
}

// GetVariableOK returns a global variable's value along with whether it was
// present, for callers that need to distinguish an unset variable from one
// explicitly set to the empty string.
func (s *Store) GetVariableOK(key string) (string, bool) {
	s.variablesMu.RLock()
	defer s.variablesMu.RUnlock()
	val, ok := s.variables[key]
	return val, ok
}

// Variables returns a copy of all global variables. Mutating the returned
// map does not affect the Store.
func (s *Store) Variables() map[string]string {
	s.variablesMu.RLock()
	defer s.variablesMu.RUnlock()
	out := make(map[string]string, len(s.variables))
	maps.Copy(out, s.variables)
	return out
}

// ApplyFromResponseJSON parses responseBody as JSON and merges scalar
// leaves into the global variables map (dotted-path keys for nested
// objects), matching internal/varsjson's flattening rules.
func (s *Store) ApplyFromResponseJSON(responseBody string) {
	s.variablesMu.Lock()
	defer s.variablesMu.Unlock()
	vj.ApplyFromJSON(s.variables, responseBody)
}

// SetEnvironment switches the current environment, creating it (with no
// variables) if it doesn't already exist.
func (s *Store) SetEnvironment(env string) {
	s.envMu.Lock()
	s.currentEnv = env
	if _, exists := s.environments[env]; !exists {
		s.environments[env] = make(map[string]string)
	}
	s.envMu.Unlock()
}

// SetEnvVariable sets a variable in the current environment, creating the
// environment if needed.
func (s *Store) SetEnvVariable(key, value string) {
	s.envMu.Lock()
	if s.environments[s.currentEnv] == nil {
		s.environments[s.currentEnv] = make(map[string]string)
	}
	s.environments[s.currentEnv][key] = value
	s.envMu.Unlock()
}

// Environments returns a deep copy of all environments and their variables.
func (s *Store) Environments() map[string]map[string]string {
	s.envMu.RLock()
	defer s.envMu.RUnlock()
	out := make(map[string]map[string]string, len(s.environments))
	for env, vars := range s.environments {
		copied := make(map[string]string, len(vars))
		maps.Copy(copied, vars)
		out[env] = copied
	}
	return out
}

// EnvVariables returns a copy of the named environment's variables, or an
// empty (non-nil) map if the environment doesn't exist.
func (s *Store) EnvVariables(env string) map[string]string {
	s.envMu.RLock()
	defer s.envMu.RUnlock()
	vars, exists := s.environments[env]
	if !exists || vars == nil {
		return make(map[string]string)
	}
	out := make(map[string]string, len(vars))
	maps.Copy(out, vars)
	return out
}

// CurrentEnvVariables returns a copy of the current environment's
// variables, or nil if the current environment has no variables recorded
// yet. The nil case is preserved (rather than an empty map) to match
// historical templating behavior that distinguished "no environment
// selected" from "environment selected but empty".
func (s *Store) CurrentEnvVariables() map[string]string {
	s.envMu.RLock()
	defer s.envMu.RUnlock()
	if s.environments == nil {
		return nil
	}
	vars := s.environments[s.currentEnv]
	if vars == nil {
		return nil
	}
	out := make(map[string]string, len(vars))
	maps.Copy(out, vars)
	return out
}

// RenameEnvironment renames an existing environment, updating currentEnv if
// it pointed at the old name. It is a no-op if oldName doesn't exist.
func (s *Store) RenameEnvironment(oldName, newName string) {
	s.envMu.Lock()
	defer s.envMu.Unlock()
	if vars, exists := s.environments[oldName]; exists {
		s.environments[newName] = vars
		delete(s.environments, oldName)
		if s.currentEnv == oldName {
			s.currentEnv = newName
		}
	}
}
