package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"rawrequest/internal/cli"
	"rawrequest/internal/parsehttp"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Options configures the MCP server.
type Options struct {
	DefaultEnv     string
	SecretResolver cli.SecretResolver
	Version        string
	Workspace      string
}

// Serve creates and starts the MCP stdio server.
func Serve(opts Options) error {
	s := server.NewMCPServer(
		"RawRequest",
		opts.Version,
		server.WithToolCapabilities(false),
		server.WithResourceCapabilities(false, false),
		server.WithPromptCapabilities(false),
		server.WithInstructions("RawRequest is a code-first HTTP client. Use list_files to discover .http files in the workspace. Use list_requests to see available requests, then run_request to execute them. File paths are auto-resolved if only one .http file exists."),
		server.WithRecovery(),
	)

	workspace := opts.Workspace
	if workspace == "" {
		workspace = "."
	}

	h := &handlers{
		defaultEnv:     opts.DefaultEnv,
		secretResolver: opts.SecretResolver,
		version:        opts.Version,
		workspace:      workspace,
		sessionVars:    make(map[string]string),
	}

	// Tools
	s.AddTool(listFilesTool(), h.handleListFiles)
	s.AddTool(listRequestsTool(), h.handleListRequests)
	s.AddTool(runRequestTool(), h.handleRunRequest)
	s.AddTool(listEnvironmentsTool(), h.handleListEnvironments)
	s.AddTool(setVariableTool(), h.handleSetVariable)
	s.AddTool(createRequestTool(), h.handleCreateRequest)
	s.AddTool(updateRequestTool(), h.handleUpdateRequest)
	s.AddTool(saveVariableTool(), h.handleSaveVariable)

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
	workspace      string
	sessionVars    map[string]string
}

// --- Tool definitions ---

func listFilesTool() mcp.Tool {
	return mcp.NewTool("list_files",
		mcp.WithDescription("Discover all .http files in the workspace. Returns file paths and request summaries for each file."),
	)
}

func listRequestsTool() mcp.Tool {
	return mcp.NewTool("list_requests",
		mcp.WithDescription("List all HTTP requests defined in a .http file. Returns name, method, URL, and group for each request."),
		mcp.WithString("file",
			mcp.Description("Path to the .http file. If omitted, auto-discovers files in workspace."),
		),
	)
}

func runRequestTool() mcp.Tool {
	return mcp.NewTool("run_request",
		mcp.WithDescription("Execute a named HTTP request from a .http file. Returns the full response including status, headers, body, and timing."),
		mcp.WithString("file",
			mcp.Description("Path to the .http file. If omitted, auto-discovers files in workspace."),
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
			mcp.Description("Path to the .http file. If omitted, auto-discovers files in workspace."),
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

func createRequestTool() mcp.Tool {
	return mcp.NewTool("create_request",
		mcp.WithDescription("Create a new HTTP request in a .http file or update an existing one by name."),
		mcp.WithString("file",
			mcp.Description("Path to the .http file. If omitted, auto-discovers or defaults to 'requests.http'."),
		),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("Request name (used for @name)"),
		),
		mcp.WithString("method",
			mcp.Required(),
			mcp.Description("HTTP method (e.g. GET, POST, PUT, DELETE)"),
		),
		mcp.WithString("url",
			mcp.Required(),
			mcp.Description("Target URL"),
		),
		mcp.WithObject("headers",
			mcp.Description("Optional key-value object of HTTP headers"),
		),
		mcp.WithString("body",
			mcp.Description("Optional raw request body content"),
		),
		mcp.WithString("preScript",
			mcp.Description("Optional JavaScript pre-request script"),
		),
		mcp.WithString("postScript",
			mcp.Description("Optional JavaScript post-request script"),
		),
		mcp.WithString("group",
			mcp.Description("Optional group name"),
		),
		mcp.WithString("depends",
			mcp.Description("Optional request name dependency"),
		),
		mcp.WithNumber("timeout",
			mcp.Description("Optional request execution timeout in seconds"),
		),
	)
}

func updateRequestTool() mcp.Tool {
	return mcp.NewTool("update_request",
		mcp.WithDescription("Modify an existing HTTP request in a .http file by name. Preserves developer comments and spacing."),
		mcp.WithString("file",
			mcp.Description("Path to the .http file. If omitted, auto-discovers."),
		),
		mcp.WithString("name",
			mcp.Required(),
			mcp.Description("The current name of the request to modify"),
		),
		mcp.WithString("newName",
			mcp.Description("New name for the request"),
		),
		mcp.WithString("method",
			mcp.Description("New HTTP method"),
		),
		mcp.WithString("url",
			mcp.Description("New URL"),
		),
		mcp.WithObject("headers",
			mcp.Description("New/updated key-value object of HTTP headers"),
		),
		mcp.WithString("body",
			mcp.Description("New request body content"),
		),
		mcp.WithString("preScript",
			mcp.Description("New JavaScript pre-request script"),
		),
		mcp.WithString("postScript",
			mcp.Description("New JavaScript post-request script"),
		),
		mcp.WithString("group",
			mcp.Description("New group name"),
		),
		mcp.WithString("depends",
			mcp.Description("New request name dependency"),
		),
		mcp.WithNumber("timeout",
			mcp.Description("New request execution timeout in seconds"),
		),
	)
}

func saveVariableTool() mcp.Tool {
	return mcp.NewTool("save_variable",
		mcp.WithDescription("Add or update a variable or environment variable in a .http file."),
		mcp.WithString("file",
			mcp.Description("Path to the .http file. If omitted, auto-discovers or defaults to 'requests.http'."),
		),
		mcp.WithString("key",
			mcp.Required(),
			mcp.Description("Variable name"),
		),
		mcp.WithString("value",
			mcp.Required(),
			mcp.Description("Variable value"),
		),
		mcp.WithString("environment",
			mcp.Description("Target environment name (e.g. dev, staging) to scope this variable. If omitted, sets a global variable."),
		),
	)
}

// --- Tool handlers ---

// resolveFile resolves the file parameter from a tool call.
// If file is provided, resolves it against workspace. If omitted, auto-discovers.
func (h *handlers) resolveFile(req mcp.CallToolRequest) (string, error) {
	file := req.GetString("file", "")
	if file != "" {
		return ResolveFilePath(h.workspace, file), nil
	}

	// Auto-discover
	files, err := DiscoverHttpFiles(h.workspace)
	if err != nil {
		return "", fmt.Errorf("error discovering files: %s", err)
	}
	if len(files) == 0 {
		return "", fmt.Errorf("no .http files found in workspace '%s'", h.workspace)
	}
	if len(files) > 1 {
		list := strings.Join(files, "\n  ")
		return "", fmt.Errorf("multiple .http files found. Specify 'file' parameter or use list_files tool:\n  %s", list)
	}
	return ResolveFilePath(h.workspace, files[0]), nil
}

func (h *handlers) handleListFiles(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	files, err := DiscoverHttpFiles(h.workspace)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Error discovering files: %s", err)), nil
	}

	if len(files) == 0 {
		return mcp.NewToolResultText("No .http files found in workspace."), nil
	}

	type fileSummary struct {
		Path     string   `json:"path"`
		Requests int      `json:"requestCount"`
		Names    []string `json:"requestNames,omitempty"`
	}

	var summaries []fileSummary
	for _, f := range files {
		absPath := ResolveFilePath(h.workspace, f)
		content, err := os.ReadFile(absPath)
		if err != nil {
			continue
		}
		parsed := cli.ParseHttpFile(string(content))
		reqs := parsed.ListRequests()

		var names []string
		for _, r := range reqs {
			if r.Name != "" && r.Name != "(unnamed)" {
				names = append(names, r.Name)
			}
		}

		summaries = append(summaries, fileSummary{
			Path:     f,
			Requests: len(reqs),
			Names:    names,
		})
	}

	data, _ := json.MarshalIndent(summaries, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}

func (h *handlers) handleListRequests(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := h.resolveFile(req)
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
	file, err := h.resolveFile(req)
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

	// Collect variables before execution to detect changes from scripts
	varsBefore := make(map[string]string, len(h.sessionVars))
	for k, v := range h.sessionVars {
		varsBefore[k] = v
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

	// Persist any variables set by scripts back to session
	for k, v := range runner.GetVariables() {
		if prev, ok := varsBefore[k]; !ok || prev != v {
			h.sessionVars[k] = v
		}
	}

	data, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(data)), nil
}

func (h *handlers) handleListEnvironments(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := h.resolveFile(req)
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

func getArguments(req mcp.CallToolRequest) map[string]interface{} {
	if req.Params.Arguments == nil {
		return nil
	}
	if args, ok := req.Params.Arguments.(map[string]interface{}); ok {
		return args
	}
	if args, ok := req.Params.Arguments.(map[string]any); ok {
		res := make(map[string]interface{})
		for k, v := range args {
			res[k] = v
		}
		return res
	}
	return nil
}

func (h *handlers) handleCreateRequest(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := h.resolveFile(req)
	if err != nil {
		if strings.Contains(err.Error(), "no .http files found") {
			file = ResolveFilePath(h.workspace, "requests.http")
		} else {
			return mcp.NewToolResultError(err.Error()), nil
		}
	}

	name, err := req.RequireString("name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	method, err := req.RequireString("method")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	url, err := req.RequireString("url")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	body := req.GetString("body", "")
	preScript := req.GetString("preScript", "")
	postScript := req.GetString("postScript", "")
	group := req.GetString("group", "")
	depends := req.GetString("depends", "")

	args := getArguments(req)

	var timeout int
	if args != nil {
		if timeoutArg, ok := args["timeout"]; ok && timeoutArg != nil {
			if f, ok := timeoutArg.(float64); ok {
				timeout = int(f)
			} else if i, ok := timeoutArg.(int); ok {
				timeout = i
			}
		}
	}

	var headers map[string]string
	if args != nil {
		if headersArg, ok := args["headers"]; ok && headersArg != nil {
			if hMap, ok := headersArg.(map[string]interface{}); ok {
				headers = make(map[string]string)
				for k, v := range hMap {
					headers[k] = fmt.Sprintf("%v", v)
				}
			} else if hMap, ok := headersArg.(map[string]any); ok {
				headers = make(map[string]string)
				for k, v := range hMap {
					headers[k] = fmt.Sprintf("%v", v)
				}
			}
		}
	}

	reqData := parsehttp.RequestData{
		Name:       name,
		Method:     method,
		URL:        url,
		Headers:    headers,
		Body:       body,
		PreScript:  preScript,
		PostScript: postScript,
		Group:      group,
		Depends:    depends,
		Timeout:    timeout,
	}

	err = parsehttp.WriteRequestToFile(file, reqData)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Failed to write request: %s", err)), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Successfully created/updated request '%s' in %s", name, file)), nil
}

func (h *handlers) handleUpdateRequest(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := h.resolveFile(req)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	name, err := req.RequireString("name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	newName := req.GetString("newName", "")
	method := req.GetString("method", "")
	url := req.GetString("url", "")
	body := req.GetString("body", "")
	preScript := req.GetString("preScript", "")
	postScript := req.GetString("postScript", "")
	group := req.GetString("group", "")
	depends := req.GetString("depends", "")

	args := getArguments(req)

	var timeout int
	if args != nil {
		if timeoutArg, ok := args["timeout"]; ok && timeoutArg != nil {
			if f, ok := timeoutArg.(float64); ok {
				timeout = int(f)
			} else if i, ok := timeoutArg.(int); ok {
				timeout = i
			}
		}
	}

	var headers map[string]string
	if args != nil {
		if headersArg, ok := args["headers"]; ok && headersArg != nil {
			if hMap, ok := headersArg.(map[string]interface{}); ok {
				headers = make(map[string]string)
				for k, v := range hMap {
					headers[k] = fmt.Sprintf("%v", v)
				}
			} else if hMap, ok := headersArg.(map[string]any); ok {
				headers = make(map[string]string)
				for k, v := range hMap {
					headers[k] = fmt.Sprintf("%v", v)
				}
			}
		}
	}

	reqData := parsehttp.RequestData{
		Name:       newName,
		Method:     method,
		URL:        url,
		Headers:    headers,
		Body:       body,
		PreScript:  preScript,
		PostScript: postScript,
		Group:      group,
		Depends:    depends,
		Timeout:    timeout,
	}

	err = parsehttp.UpdateRequestInFile(file, name, reqData)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Failed to update request: %s", err)), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Successfully updated request '%s' in %s", name, file)), nil
}

func (h *handlers) handleSaveVariable(_ context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	file, err := h.resolveFile(req)
	if err != nil {
		if strings.Contains(err.Error(), "no .http files found") {
			file = ResolveFilePath(h.workspace, "requests.http")
		} else {
			return mcp.NewToolResultError(err.Error()), nil
		}
	}

	key, err := req.RequireString("key")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	value, err := req.RequireString("value")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	environment := req.GetString("environment", "")

	err = parsehttp.SaveVariableInFile(file, key, value, environment)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Failed to save variable: %s", err)), nil
	}

	scope := "global"
	if environment != "" {
		scope = fmt.Sprintf("environment '%s'", environment)
	}
	return mcp.NewToolResultText(fmt.Sprintf("Successfully saved %s variable '%s' to %s", scope, key, file)), nil
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
1. Use **list_files** to discover .http files in the workspace
2. Use **list_requests** to see available requests (file is auto-resolved if only one .http file exists)
3. Use **list_environments** to see available environments
4. Use **set_variable** to set any needed variables
5. Use **run_request** to execute requests
`)

	return []mcp.ResourceContents{
		mcp.TextResourceContents{
			URI:      "rawrequest://guide",
			MIMEType: "text/markdown",
			Text:     guide,
		},
	}, nil
}
