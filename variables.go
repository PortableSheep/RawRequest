// Variable and environment management for RawRequest.
// This file contains functions for managing request variables and environments.

package main

import "fmt"

// SetVariable sets a variable
func (a *App) SetVariable(key, value string) {
	a.variables[key] = value
	// a.SaveData()
}

// GetVariable gets a variable
func (a *App) GetVariable(key string) string {
	return a.variables[key]
}

// SetEnvironment sets the current environment
func (a *App) SetEnvironment(env string) {
	a.currentEnv = env
	if _, exists := a.environments[env]; !exists {
		a.environments[env] = make(map[string]string)
	}
	// a.SaveData()
}

// SetEnvVariable sets a variable in the current environment
func (a *App) SetEnvVariable(key, value string) {
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	// a.SaveData()
}

// GetEnvironments returns all environments
func (a *App) GetEnvironments() map[string]map[string]string {
	return a.environments
}

// GetVariables returns all variables
func (a *App) GetVariables() map[string]string {
	return a.variables
}

// GetEnvVariables returns variables for a specific environment
func (a *App) GetEnvVariables(env string) map[string]string {
	if vars, exists := a.environments[env]; exists {
		return vars
	}
	return make(map[string]string)
}

// AddEnvVariable adds a variable to the current environment
func (a *App) AddEnvVariable(key, value string) {
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	// a.SaveData()
}

// RenameEnvironment renames an environment
func (a *App) RenameEnvironment(oldName, newName string) {
	if vars, exists := a.environments[oldName]; exists {
		a.environments[newName] = vars
		delete(a.environments, oldName)
		if a.currentEnv == oldName {
			a.currentEnv = newName
		}
		// a.SaveData()
	}
}

// setVariablesFromMap recursively sets variables from a nested map structure
func (a *App) setVariablesFromMap(prefix string, data map[string]interface{}) {
	for key, value := range data {
		fullKey := key
		if prefix != "" {
			fullKey = prefix + "." + key
		}
		switch v := value.(type) {
		case string:
			a.variables[fullKey] = v
		case float64:
			a.variables[fullKey] = fmt.Sprintf("%.0f", v)
		case map[string]interface{}:
			a.setVariablesFromMap(fullKey, v)
		}
	}
}
