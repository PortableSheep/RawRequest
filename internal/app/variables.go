package app

// SetVariable, GetVariable, and the environment methods below are the
// stable Wails-bound façade for variable/environment management. They
// delegate to the concurrency-safe internal/variablestore.Store owned by
// App (a.vars); the storage, locking, and copy semantics live there so they
// can be tested independently of App and Wails.

func (a *App) SetVariable(key, value string) {
	a.vars.SetVariable(key, value)
}

func (a *App) GetVariable(key string) string {
	return a.vars.GetVariable(key)
}

func (a *App) SetEnvironment(env string) {
	a.vars.SetEnvironment(env)
}

func (a *App) SetEnvVariable(key, value string) {
	a.vars.SetEnvVariable(key, value)
}

func (a *App) GetEnvironments() map[string]map[string]string {
	return a.vars.Environments()
}

func (a *App) GetVariables() map[string]string {
	return a.vars.Variables()
}

func (a *App) GetEnvVariables(env string) map[string]string {
	return a.vars.EnvVariables(env)
}

func (a *App) AddEnvVariable(key, value string) {
	a.SetEnvVariable(key, value)
}

func (a *App) RenameEnvironment(oldName, newName string) {
	a.vars.RenameEnvironment(oldName, newName)
}
