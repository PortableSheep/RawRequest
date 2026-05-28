# RawRequest

**Code-first HTTP client platform.** Write requests in `.http` files. Run them from a polished desktop GUI, your terminal, or directly via your AI assistant.

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

---

## One Engine, Three Modes

RawRequest compiled as a single Go binary operates in three distinct, seamless modes:

| Mode | Command / Environment | Purpose | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **Desktop Mode** | **RawRequest Desktop (GUI)** | Premium visual workspace for building, debugging, and mock prototyping | CodeMirror 6, Encrypted Keyring, Visual Charts, Console Drawers, Silent Hot-Reloading |
| **CLI Mode** | `rawrequest run` / `load` | CI/CD pipelines, shell scripting, and high-concurrency benchmarks | Concurrency controls, ramp-up rules, failure rate thresholds, JSON output options |
| **MCP Mode** | `rawrequest mcp` | Direct stdio bridge for AI developer assistants (Claude, Copilot) | Automatic workspace discovery, run requests, fetch environments, session state |

---

## The `.http` File Syntax & Directives

RawRequest supports an enhanced version of the JetBrains/VS Code style `.http` format, incorporating stateful request chaining, concurrency configs, and JS-scripted API mocks in the same file.

```http
# === Environments ===
@env.dev.baseUrl = http://localhost:8080
@env.prod.baseUrl = https://api.example.com

# === Global Variables ===
@contentType = application/json

### GET Client Request
GET {{baseUrl}}/users
Accept: {{contentType}}

### Authenticate Outgoing Client Request
@name login
POST {{baseUrl}}/auth/login
Content-Type: {{contentType}}

< {
  // Pre-request JS script
  console.log('Initiating authenticating request...');
}

{
  "username": "admin",
  "password": "{{secret:adminPassword}}"
}

> {
  // Post-response JS assertions & variable sharing
  assert(response.status === 200, `Expected status 200 but got ${response.status}`);
  setVar('token', response.json.token);
}

### Chained Client Request (Requires Token)
@name getProfile
@depends login
GET {{baseUrl}}/profile
Authorization: Bearer {{token}}

### High-Concurrency Performance Benchmark
@name stressTest
@load duration=30s users=50 rampUp=5s rps=200

GET {{baseUrl}}/health
```

---

## Interactive Local Mock Server (with SQLite Backend)

RawRequest features a built-in stateful local Mock Server. You can mix mock definitions, startup initializers, and normal outgoing requests in the **exact same `.http` file**.

### Declaring Mocks & Startup Initializers
* **`@mockinit` Block:** Executed **exactly once** when the mock server starts up (before accepting HTTP calls). Use this to prepare your database tables and seed test data.
* **`@mock` Route Definition:** Preceded by `@mock` to define passive local endpoint responders. In the Desktop GUI, `@mock` definitions have **no play gutter buttons**, keeping your workspace uncluttered and cleanly dividing mock routes from active client triggers.

```http
### 1. Mock Database Initializer (Runs once at server boot)
@mockinit
< {
  // Initialize persistent SQLite database schema
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, email TEXT)");
  
  // Seed database if empty
  const count = db.query("SELECT COUNT(*) as cnt FROM users")[0].cnt;
  if (count === 0) {
    db.exec("INSERT INTO users (name, email) VALUES ('Alice', 'alice@rawrequest.dev')");
  }
  console.log("Mock database schemas prepared successfully.");
}

### 2. Stateful Mock: Register a new profile into SQLite
@mock
POST /db/users
Content-Type: application/json

< {
  try {
    const body = JSON.parse(request.body);
    
    // Perform write query
    const res = db.exec("INSERT INTO users (name, email) VALUES (?, ?)", body.name, body.email);
    
    // Return dynamic stateful response
    response.status = 201;
    response.body = {
      id: res.lastInsertId,
      name: body.name,
      email: body.email,
      created: true
    };
  } catch(e) {
    response.status = 400;
    response.body = { error: "Failed to insert record: " + e.toString() };
  }
}

### 3. Stateful Mock: Query profiles from SQLite
@mock
GET /db/users
Content-Type: application/json

< {
  // Query records dynamically
  const users = db.query("SELECT * FROM users ORDER BY id DESC");
  response.body = users;
}
```

### The Embedded SQLite JS Database API
Inside any `< { ... }` mock or initializer handler script, RawRequest exposes a dedicated persistent SQLite database via the global `db` object:

*   **`db.exec(sql, ...args)`**: Executes an action query (e.g. `CREATE`, `INSERT`, `UPDATE`, `DELETE`). Returns an object with:
    *   `rowsAffected`: Number of modified rows.
    *   `lastInsertId`: The auto-incremented primary ID of the inserted record.
*   **`db.query(sql, ...args)`**: Executes a read query (e.g. `SELECT`). Returns an array of objects representing the resulting rows.
*   **`db.get(sql, ...args)`**: Convenience method returning the first matched row object or `null`.

---

## CLI Mode

### `rawrequest run` — Execute Requests
Run client requests and verify APIs from your terminal:
```bash
# Run a specific named request
rawrequest run api.http -n login

# Target a specific environment profile
rawrequest run api.http -n getProfile -e prod

# Hydrate variables dynamically
rawrequest run api.http -n getProfile -V "baseUrl=https://api.custom.com"

# Stream only the JSON body response (perfect for jq piping)
rawrequest run api.http -n getProfile -o body | jq .
```

### `rawrequest load` — Stress Test APIs
Turn any request into a concurrency benchmark:
```bash
# Execute the @load configuration defined in the file
rawrequest load api.http -n healthCheck

# Override concurrent users and duration on the fly
rawrequest load api.http -n healthCheck --users 100 --duration 1m

# Define concurrent ramp-up, target rate, and failure abort threshold
rawrequest load api.http -n healthCheck --users 50 --rps 250 --ramp-up 10s --fail-rate 0.05
```

---

## Model Context Protocol (MCP) Server

Connect your AI assistants (Claude Code, Claude Desktop, GitHub Copilot) directly to your local APIs. RawRequest operates over a zero-port stdio transport.

### 1. Register the MCP Server
Add the following stdio configurations to your AI client's configuration file:

**Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):**
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

**VS Code GitHub Copilot (`.vscode/mcp.json`):**
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

### 2. Available Stdio AI Tools
Once configured, the AI assistant can naturally invoke these tools:
*   `list_files`: Scans and discovers all `.http` files in the workspace.
*   `list_requests`: Lists request metadata inside a file (method, URL, parameters).
*   `run_request`: Executes a specific client request and returns the full body, status, headers, and timings.
*   `list_environments`: Discovers per-environment config profiles.
*   `set_variable`: Sets a temporary session variable context for request chains.
*   `create_request`: Creates a named request in a `.http` file.
*   `update_request`: Modifies an existing named request while preserving surrounding content.
*   `save_variable`: Persists a global or environment-scoped variable back to the `.http` file.

---

## Premium Developer Experience (DX)

RawRequest Desktop incorporates several advanced, premium editor features to keep your workflow fluent:

*   **Mock Param Linter Bypass:** Dynamic path parameters (e.g. `/users/{{id}}` matching `{{id}}` inside the JSON mock body) are automatically analyzed as locally-scoped mock parameters. The linter suppresses "Unknown Variable" warning diagnostics for them, guaranteeing a completely clean, warning-free editor panel.
*   **Fuzzy Navigation Panels (with Mock Exclusions):** The Command Palette (<kbd>⌘ P</kbd>) and Outline Panel (<kbd>⌘ Shift O</kbd>) let you filter and jump across massive files in real-time. They automatically **exclude** `@mock` API definitions to prioritize standard outgoing client requests, while safely preserving execution indexes.
*   **Unsaved Changes Guard & Silent File watcher:** The GUI monitors open files' disk timestamps. If a file is modified externally (e.g. saved by an AI coding agent or IDE) and you have no unsaved changes in RawRequest, the editor **silently and instantly reloads** the new content. If you have dirty edits, a clear prompt guards your work.
*   **Compositor White-Flash Elimination:** Built with premium CSS-level compositor layers, setting background colors directly down to the lowest CodeMirror editor DOM leaves zero unpainted layers, guaranteeing a 100% smooth, dark-theme focus experience without annoying WebKit white-flashing.

---

## Development

### Dev Workflow
```bash
# Setup Node dependencies
cd frontend && npm install && cd ..

# Launch development environment (hot-reloading Wails desktop + Go helper service)
./scripts/dev-build.sh
```

### Run Unit Tests
Ensure everything is fully passing before contributing:
```bash
# Go backend test suite
go test ./...

# Frontend Vitest test suite
cd frontend && npm test
```

## License

PolyForm Noncommercial License 1.0.0 — see [LICENSE](./LICENSE)
