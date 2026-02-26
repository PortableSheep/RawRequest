package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"rawrequest/internal/cli"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Options configures the MCP server.
type Options struct {
	DefaultEnv     string
	SecretResolver cli.SecretResolver
	Version        string
}

// Serve creates and starts the MCP stdio server.
func Serve(opts Options) error {
	s := server.NewMCPServer(
		"RawRequest",
		opts.Version,
		server.WithToolCapabilities(false),
		server.WithResourceCapabilities(false, false),
		server.WithPromptCapabilities(false),
		server.WithInstructions("RawRequest is a code-first HTTP client. Use list_requests to discover available requests in a .http file, then run_request to execute them. Use list_environments to see available environments."),
		server.WithRecovery(),
	)

	h := &handlers{
		defaultEnv:     opts.DefaultEnv,
		secretResolver: opts.SecretResolver,
		version:        opts.Version,
		sessionVars:    make(map[string]string),
	}

	// Tools
	s.AddTool(listRequestsTool(), h.handleListRequests)
	s.AddTool(runRequestTool(), h.handleRunRequest)
	s.AddTool(listEnvironmentsTool(), h.handleListEnvironments)
	s.AddTool(setVariableTool(), h.handleSetVariable)

	// Resources
	s.AddResource(
		mcp.NewResource(
			"rawrequest://guide",
			"RawRequest Usage Guide",
			mcp.WithResourceDescription("How to use RawRequest MCP tools and .http file format"),
			mcp.WithMIMEType("text/markdown"),
		),
		h.handleGuideResource,
	)

	return server.ServeStdio(s)
}

type handlers struct {
	defaultEnv     string
	secretResolver cli.SecretResolver
	version        string
	sessionVars    map[string]string
}

// --- Tool definitions ---

func listRequestsTool() mcp.Tool {
	return mcp.NewTool("list_requests",
		mcp.WithDescription("List all HTTP requests defined in a .http file. Returns name, method, URL, and group for each request."),
		mcp.WithString("file",
			mcp.Required(),
			mcp.Description("Path to the .http file"),
		),
	)
}

func runRequestTool() mcp.Tool {
	return mcp.NewTool("run_request",
		mcp.WithDescription("Execute a named HTTP request from a .http file. Returns the full response including status, headers, body, and timing."),
		mcp.WithString("file",
			mcp.Required(),
			mcp.Description("Path to the .http file"),
		),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Name of the request to execute (from @name directive)"),
		),
		mcp.WithString("environment",
			mcp.Description("Environment to use (e.g. 'dev', 'staging'). Uses default if omitted."),
		),
	)
}

func listEnvironmentsTool() mcp.Tool {
	return mcp.NewTool("list_environments",
		mcp.WithDescription("List all environments and their variables defined in a .http file."),
		mcp.WithString("file",
			mcp.Required(),
			mcp.Description("Path to the .http file"),
		),
	)
}

func setVariableTool() mcp.Tool {
	return mcp.NewTool("set_variable",
		mcp.WithDescription("Set a variable for use in subsequent request executions. Persists for the duration of this MCP session."),
		mcp.WithString("key",
			mcp.Required(),
			mcp.Description("Variable name"),
		),
		mcp.WithString("value",
			mcp.Required(),
			mcp.Description("Variable value"),
		),
	)
}

// --- Tool handlers ---

func (h *handlers) handleListRequests(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := req.RequireString("file")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	content, err := os.ReadFile(file)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Error reading file: %s", err)), nil
	}

	parsed := cli.ParseHttpFile(string(content))
	summaries := parsed.ListRequests()

	if len(summaries) == 0 {
		return mcp.NewToolResultText("No requests found in file."), nil
	}

	data, _ := json.MarshalIndent(summaries, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}

func (h *handlers) handleRunRequest(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := req.RequireString("file")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	name, err := req.RequireString("name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	env := req.GetString("environment", h.defaultEnv)
	if env == "" {
		env = "default"
	}

	content, err := os.ReadFile(file)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Error reading file: %s", err)), nil
	}

	parsed := cli.ParseHttpFile(string(content))
	requests := parsed.FindRequestsByName([]string{name})
	if len(requests) == 0 {
		return mcp.NewToolResultError(fmt.Sprintf("No request found with name '%s'", name)), nil
	}

	// Build runner with session variables + file variables
	opts := &cli.Options{
		Variables:   make(map[string]string),
		Environment: env,
		Timeout:     30,
	}
	for k, v := range h.sessionVars {
		opts.Variables[k] = v
	}

	runner := cli.NewRunner(opts, h.version)
	if h.secretResolver != nil {
		runner.SetSecretResolver(h.secretResolver)
	}

	// Load file variables (session vars take precedence)
	for k, v := range parsed.Variables {
		if _, exists := opts.Variables[k]; !exists {
			runner.SetVariable(k, v)
		}
	}

	// Load environment variables
	if envVars, ok := parsed.Environments[env]; ok {
		for k, v := range envVars {
			runner.SetVariable(k, v)
		}
	}

	result := runner.ExecuteRequest(requests[0])
	data, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}

func (h *handlers) handleListEnvironments(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := req.RequireString("file")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	content, err := os.ReadFile(file)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Error reading file: %s", err)), nil
	}

	parsed := cli.ParseHttpFile(string(content))
	envs := parsed.ListEnvironments()

	if len(envs) == 0 {
		return mcp.NewToolResultText("No environments defined in file."), nil
	}

	// Build a structured response
	type envInfo struct {
		Name      string            `json:"name"`
		Variables map[string]string `json:"variables"`
	}
	var result []envInfo
	for _, name := range envs {
		result = append(result, envInfo{
			Name:      name,
			Variables: parsed.Environments[name],
		})
	}

	data, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}

func (h *handlers) handleSetVariable(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	key, err := req.RequireString("key")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	value, err := req.RequireString("value")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	h.sessionVars[key] = value
	return mcp.NewToolResultText(fmt.Sprintf("Variable '%s' set to '%s'", key, value)), nil
}

// --- Resource handlers ---

func (h *handlers) handleGuideResource(_ context.Context, _ mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	guide := strings.TrimSpace(`
# RawRequest MCP Usage Guide

## .http File Format

RawRequest uses .http files to define HTTP requests. Requests are separated by ` + "`###`" + `.

### Basic Request
` + "```" + `
### Login
@name login
POST {{baseUrl}}/auth/login
Content-Type: application/json

{"username": "{{user}}", "password": "{{secret:password}}"}

### Get Profile
@name getProfile
@depends login
GET {{baseUrl}}/profile
Authorization: Bearer {{response.login.token}}
` + "```" + `

## Directives
- ` + "`@name <name>`" + ` — Name the request (required for chaining and MCP execution)
- ` + "`@depends <name1>, <name2>`" + ` — Declare dependencies on other requests
- ` + "`@env.<envName>.<varName> = <value>`" + ` — Define environment-specific variables
- ` + "`@timeout <ms>`" + ` — Set request timeout
- ` + "`@group <name>`" + ` — Group related requests

## Variables
- ` + "`{{variableName}}`" + ` — Replaced with variable value
- ` + "`{{secret:keyName}}`" + ` — Replaced with secret from vault
- ` + "`{{env.SYSTEM_VAR}}`" + ` — System environment variable
- ` + "`{{response.<name>.<path>}}`" + ` — Value from a prior named response

## Workflow
1. Use **list_requests** to see available requests
2. Use **list_environments** to see available environments
3. Use **set_variable** to set any needed variables
4. Use **run_request** to execute requests
`)

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:      "rawrequest://guide",
			MIMEType: "text/markdown",
			Text:     guide,
		},
	}, nil
}
