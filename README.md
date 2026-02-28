# RawRequest

**Code-first HTTP client.** Write requests in `.http` files. Run them from the terminal, your AI assistant, or a full desktop GUI.

![Main window](docs/MainWindow.png)

## Quick Install

**macOS (Homebrew):**
```bash
brew tap portablesheep/rawrequest https://github.com/portablesheep/homebrew-rawrequest
brew install --cask rawrequest
```

**macOS / Linux (curl):**
```bash
curl -fsSL https://raw.githubusercontent.com/portablesheep/RawRequest/main/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/portablesheep/RawRequest/main/scripts/install.ps1 | iex
```

**Manual:** Download from [Releases](https://github.com/portablesheep/RawRequest/releases).

## What is RawRequest?

RawRequest has two components that share the same `.http` file format and execution engine:

| | **rawrequest CLI** | **RawRequest Desktop** |
|---|---|---|
| **What** | Single binary — CLI commands + MCP mode | GUI application |
| **For** | Terminal, CI/CD, AI assistants | Editing, visual testing, managing secrets |
| **Install** | `brew install`, `curl`, or download binary | `.dmg` / `.exe` from Releases |

## .http File Format

```http
# === Environments ===
@env.dev.baseUrl = http://localhost:3000
@env.prod.baseUrl = https://api.example.com

# === Variables ===
@contentType = application/json

### GET request
GET {{baseUrl}}/users
Accept: application/json

### POST with body
POST {{baseUrl}}/users
Content-Type: {{contentType}}

{
  "name": "Jane",
  "email": "jane@example.com"
}

### Secrets
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "password": "{{secret:myPassword}}"
}

### Scripts (pre and post)
@name login
POST {{baseUrl}}/auth/login
Content-Type: application/json

< {
  // Pre-request script
  console.log('Logging in...');
}

{
  "username": "admin",
  "password": "{{secret:password}}"
}

> {
  // Post-response script
  assert(response.status === 200, `Expected 200, got ${response.status}`);
  setVar('token', response.json.token);
}

### Request chaining
@name getProfile
@depends login
GET {{baseUrl}}/profile
Authorization: Bearer {{token}}

### Load testing
@name healthCheck
@load
duration: 30s
users: 50
rampUp: 5s
targetRPS: 200

GET {{baseUrl}}/health
```

**Key syntax:**
- `###` separates requests
- `@name` identifies a request for chaining/targeting
- `@depends` declares dependencies on other named requests
- `@env.<env>.<var>` defines per-environment variables
- `@timeout` sets per-request timeout in milliseconds
- `{{var}}` interpolates variables; `{{secret:key}}` resolves secrets
- `< { }` pre-request script; `> { }` post-response script
- Scripts have access to `request`, `response`, `setVar()`, `assert()`, `console.log()`

## CLI

### `rawrequest run` — Execute requests

```bash
# Run a named request
rawrequest run api.http -n login

# Use an environment
rawrequest run api.http -n getUsers -e prod

# Set variables
rawrequest run api.http -n createUser -V "username=john" -V "email=john@test.com"

# Output formats: full (default), json, body, quiet
rawrequest run api.http -n getData -o body | jq .

# Skip pre/post scripts
rawrequest run api.http -n getData --no-scripts

# Verbose mode (show request details)
rawrequest run api.http -n login --verbose
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name` | `-n` | *(required)* | Request name (repeatable) |
| `--env` | `-e` | `default` | Environment |
| `--var` | `-V` | | Variable `key=value` (repeatable) |
| `--output` | `-o` | `full` | Output format: `full\|json\|body\|quiet` |
| `--timeout` | | `30` | Timeout in seconds |
| `--verbose` | | `false` | Show request details |
| `--no-scripts` | | `false` | Disable pre/post scripts |

### `rawrequest load` — Run load tests

Run load tests against named requests from the command line.

```bash
# Basic load test — 10 users for 30 seconds
rawrequest load api.http -n healthCheck

# Custom concurrency and duration
rawrequest load api.http -n healthCheck --users 50 --duration 2m

# Rate limiting with ramp-up
rawrequest load api.http -n healthCheck --rps 200 --ramp-up 10s --users 100

# Abort if failure rate exceeds threshold
rawrequest load api.http -n healthCheck --users 50 --fail-rate 0.05

# Adaptive load control
rawrequest load api.http -n healthCheck --adaptive --users 100

# JSON output for CI pipelines
rawrequest load api.http -n healthCheck -o json
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name` | `-n` | *(required)* | Request name to load test |
| `--env` | `-e` | `default` | Environment |
| `--var` | `-V` | | Variable `key=value` (repeatable) |
| `--users` | | `10` | Max concurrent users |
| `--duration` | | `30s` | Test duration (e.g. `30s`, `2m`) |
| `--rps` | | `0` | Target requests/sec (0 = unlimited) |
| `--ramp-up` | | | Ramp-up period (e.g. `10s`) |
| `--fail-rate` | | `0` | Failure rate threshold to abort (0.0–1.0) |
| `--adaptive` | | `false` | Enable adaptive load control |
| `--output` | `-o` | `full` | Output format: `full\|json\|quiet` |
| `--timeout` | | `30` | Per-request timeout in seconds |

Output includes response time percentiles (P50, P95, P99), throughput, error breakdown, and status code distribution.

### `rawrequest list` — List requests

```bash
rawrequest list api.http
```

### `rawrequest envs` — List environments

```bash
rawrequest envs api.http
```

## MCP Server

RawRequest works as an [MCP](https://modelcontextprotocol.io) server, letting AI assistants discover and execute your HTTP requests via chat. Uses stdio transport — no ports needed.

### Setup

```bash
rawrequest mcp [--workspace <dir>] [--env <name>]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--workspace` | `-w` | `.` | Root directory for `.http` file discovery |
| `--env` | `-e` | | Default environment for requests |

### Available Tools

| Tool | Description |
|------|-------------|
| `list_files` | Discover all `.http` files in the workspace |
| `list_requests` | List requests in a file (name, method, URL, group) |
| `run_request` | Execute a named request and return the full response |
| `list_environments` | Show environments and their variables |
| `set_variable` | Set a session variable for subsequent requests |

### Auto-Discovery

When a tool's `file` parameter is omitted, RawRequest automatically searches the workspace:
- **One `.http` file found** → used automatically
- **Multiple files found** → error prompts to specify a file or use `list_files`
- **No files found** → error message

### Configuration Examples

Most clients launch MCP servers from your project directory. Since `--workspace` defaults to `.` (current directory), you typically don't need it — auto-discovery just works.

**Claude Code** — project (`.mcp.json` in project root):
```json
{
  "mcpServers": {
    "rawrequest": {
      "command": "rawrequest",
      "args": ["mcp"]
    }
  }
}
```

**Claude Code** — global (`~/.claude.json`):
```json
{
  "mcpServers": {
    "rawrequest": {
      "command": "rawrequest",
      "args": ["mcp"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "rawrequest": {
      "command": "rawrequest",
      "args": ["mcp", "--workspace", "/absolute/path/to/project"]
    }
  }
}
```

> Claude Desktop does not support variable expansion or cwd — an absolute path is required.

**GitHub Copilot — VS Code** (`.vscode/mcp.json`):
```json
{
  "servers": {
    "rawrequest": {
      "type": "stdio",
      "command": "rawrequest",
      "args": ["mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

**GitHub Copilot — project-wide** (`.github/copilot-mcp.json`):
```json
{
  "servers": {
    "rawrequest": {
      "command": "rawrequest",
      "args": ["mcp", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

**GitHub Copilot CLI** — global (`~/.copilot/mcp-config.json`):
```json
{
  "mcpServers": {
    "rawrequest": {
      "command": "rawrequest",
      "args": ["mcp"]
    }
  }
}
```

### Secrets

The MCP server resolves `{{secret:KEY}}` placeholders using the same encrypted vault as the desktop app. Set up secrets in the GUI first — they work automatically in MCP and CLI modes.

## RawRequest Desktop

The desktop application provides a full GUI for working with `.http` files:

- **Code editor** — CodeMirror 6 with syntax highlighting, folding, linting, and variable diagnostics
- **Request execution** — Visual response viewer with timing breakdown
- **Secret vault** — Encrypted secret management with usage tracking
- **Request history** — Browse and re-run past requests
- **Collection import** — Import from Postman and Bruno
- **Request navigation** — Outline panel (<kbd>⌘ Shift O</kbd>) and command palette (<kbd>⌘ P</kbd>)
- **Load testing** — Visual load test runner with live progress and result charts

![Load test in progress](docs/LoadTestInProgress.png)

![Load test results](docs/LoadTestResult.png)

## Development

### Prerequisites
- Go 1.24+
- Node.js 20+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

### Dev Workflow
```bash
cd frontend && npm install && cd ..

# Development mode with hot reload
./scripts/dev-build.sh

# Build only (no dev server)
./scripts/dev-build.sh --build-only
```

### Testing
```bash
# Backend
go test ./...

# Frontend
cd frontend && npm test
```

### Building
```bash
./scripts/build.sh
```

## Architecture

RawRequest is a single Go binary that operates in multiple modes:

- **CLI mode** — `rawrequest run|load|list|envs` executes directly and exits
- **MCP mode** — `rawrequest mcp` runs a long-lived stdio server for AI clients
- **Desktop mode** — the GUI app runs an internal HTTP backend on localhost; the Angular frontend communicates with it

All modes share the same request parsing, execution, scripting, and templating core.

## License

PolyForm Noncommercial License 1.0.0 — see [LICENSE](./LICENSE)
