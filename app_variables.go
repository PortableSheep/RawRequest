package main

func (a *App) SetVariable(key, value string) {
	a.variablesMu.Lock()
	a.variables[key] = value
	a.variablesMu.Unlock()
}

func (a *App) GetVariable(key string) string {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	return a.variables[key]
}

func (a *App) SetEnvironment(env string) {
	a.envMu.Lock()
	a.currentEnv = env
	if _, exists := a.environments[env]; !exists {
		a.environments[env] = make(map[string]string)
	}
	a.envMu.Unlock()
}

func (a *App) SetEnvVariable(key, value string) {
	a.envMu.Lock()
	if a.environments[a.currentEnv] == nil {
		a.environments[a.currentEnv] = make(map[string]string)
	}
	a.environments[a.currentEnv][key] = value
	a.envMu.Unlock()
}

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

func (a *App) GetVariables() map[string]string {
	a.variablesMu.RLock()
	defer a.variablesMu.RUnlock()
	out := make(map[string]string, len(a.variables))
	for k, v := range a.variables {
		out[k] = v
	}
	return out
}

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

func (a *App) AddEnvVariable(key, value string) {
	a.SetEnvVariable(key, value)
}

func (a *App) RenameEnvironment(oldName, newName string) {
	a.envMu.Lock()
	defer a.envMu.Unlock()
	if vars, exists := a.environments[oldName]; exists {
		a.environments[newName] = vars
		delete(a.environments, oldName)
		if a.currentEnv == oldName {
			a.currentEnv = newName
		}
	}
}
