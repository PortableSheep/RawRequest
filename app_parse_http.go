package main

import (
	"os"

	"rawrequest/internal/parsehttp"
)

func (a *App) ParseHttp(content string, variables map[string]string, envVars map[string]string) []map[string]interface{} {
	return parsehttp.Parse(content, variables, envVars, os.Environ(), os.ReadFile)
}
