// Variable and environment management for RawRequest.
// This file contains functions for managing request variables and environments.

package main

// SetVariable sets a variable
func (a *App) SetVariable(key, value string) {
	a.variablesMu.Lock()
	a.variables[key] = value
	a.variablesMu.Unlock()
	// a.SaveData()
}

// GetVariable gets a variable
func (a *App) GetVariable(key string) string {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	return a.variables[key]
}

// SetEnvironment sets the current environment
func (a *App) SetEnvironment(env string) {
	a.envMu.Lock()
	a.currentEnv = env
	if _, exists := a.environments[env]; !exists {
		a.environments[env] = make(map[string]string)
	}
	a.envMu.Unlock()
	// a.SaveData()
}

// SetEnvVariable sets a variable in the current environment
func (a *App) SetEnvVariable(key, value string) {
	a.envMu.Lock()
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	a.envMu.Unlock()
	// a.SaveData()
}

// GetEnvironments returns all environments
func (a *App) GetEnvironments() map[string]map[string]string {
	a.envMu.RLock()
	defer a.envMu.RUnlock()
	out := make(map[string]map[string]string, len(a.environments))
	for env, vars := range a.environments {
		copied := make(map[string]string, len(vars))
		for k, v := range vars {
			copied[k] = v
		}
		out[env] = copied
	}
	return out
}

// GetVariables returns all variables
func (a *App) GetVariables() map[string]string {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	out := make(map[string]string, len(a.variables))
	for k, v := range a.variables {
		out[k] = v
	}
	return out
}

// GetEnvVariables returns variables for a specific environment
func (a *App) GetEnvVariables(env string) map[string]string {
	a.envMu.RLock()
	defer a.envMu.RUnlock()
	vars, exists := a.environments[env]
	if !exists || vars == nil {
		return make(map[string]string)
	}
	out := make(map[string]string, len(vars))
	for k, v := range vars {
		out[k] = v
	}
	return out
}

// AddEnvVariable adds a variable to the current environment
func (a *App) AddEnvVariable(key, value string) {
	a.SetEnvVariable(key, value)
	// a.SaveData()
}

// RenameEnvironment renames an environment
func (a *App) RenameEnvironment(oldName, newName string) {
	a.envMu.Lock()
	defer a.envMu.Unlock()
	if vars, exists := a.environments[oldName]; exists {
		a.environments[newName] = vars
		delete(a.environments, oldName)
		if a.currentEnv == oldName {
			a.currentEnv = newName
		}
		// a.SaveData()
	}
}
