# Architecture

This is the canonical architecture reference for RawRequest. It is linked from
[README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) — update
this file when the architecture changes rather than duplicating notes
elsewhere.

## Project Overview

RawRequest is a code-first HTTP client platform consisting of a Go backend and
an Angular frontend, compiled into a **single Go binary** that operates in
three modes:

1. **Desktop Mode (Wails):** A desktop GUI built with Angular, rendered by a
   native Wails v2 webview.
2. **CLI Mode:** Command-line tools for running requests (`rawrequest run`)
   and load tests (`rawrequest load`).
3. **MCP Mode:** An MCP (Model Context Protocol) stdio server (`rawrequest
   mcp`) for integration with AI assistants.

### Key Technologies

* **Backend:** Go (1.24+), Wails v2, Goja (JavaScript execution), mcp-go.
* **Frontend:** Angular (v21+), CodeMirror 6, Vitest.
* **Data Format:** Enhanced `.http` files (JetBrains/VS Code style with
  RawRequest-specific extensions — see [README.md](../README.md) for syntax).

## Entry Points

* **`main.go`** (repo root) is the actual Go program entry point. It:
  * Parses CLI args via `internal/cli`; if a CLI/MCP/service command is
    detected, it runs that path and exits without starting the GUI.
  * Otherwise falls through to GUI mode, constructing `app.NewApp(...)` and
    starting `wails.Run(...)`.
  * Embeds the built frontend via `//go:embed all:frontend/dist` and the
    bundled `examples/*` via a second `//go:embed`.
* **`internal/app/app.go`** defines the `App` struct — the actual Wails-bound
  application object (`Bind: []interface{}{a}` in `main.go`). This is where
  most backend business logic and Wails-callable methods live:
  * Variable and environment management (`variables`, `environments`,
    `currentEnv`)
  * Request execution orchestration
  * Secret vault integration (`SecretVault`)
  * Script logging via ring buffer (`scriptLogs`)
  * Request cancellation tracking (`requestCancels`)

  Do not confuse the two: `main.go` wires up the process (CLI dispatch, Wails
  bootstrap, asset embedding); `internal/app/app.go` is the frontend-facing
  application logic.

## Backend Structure (`internal/`)

* `parsehttp`: Parses `.http` files into request objects. Handles directives
  like `@name`, `@env.*`, `@depends`, `@load`, and script blocks (`< { }` for
  pre-scripts, `> { }` for post-scripts).
* `requestchain`: Executes chained requests respecting `@depends` directives.
  Maintains a `responseStore` for accessing prior request results.
* `scriptruntime`: Provides the JavaScript execution context
  (`ExecutionContext`) containing `Request`, `Response`, `Variables`,
  `ResponseStore`, and `Assertions`.
* `scriptexec`: Executes JavaScript using the Goja VM, exposing helpers like
  `setVar()`, `assert()`, `console.log()`.
* `templating`: Resolves `{{variable}}` placeholders, including special forms
  like `{{secret:key}}` and `{{response.name.path.to.value}}`.
* `httpclientlogic`: Core HTTP client logic with a timing breakdown (DNS,
  TCP, TLS, TTFB, content transfer).
* `loadtest`, `loadtestbridge`, `loadtestpayload`, `loadtestrunlogic`: Load
  testing engine with RPS limiting, adaptive spawn rates, and failure-rate
  monitoring.
* `secretvaultlogic`: Encrypted secret storage backed by the OS keyring.
* `cli`: CLI mode argument parsing and command execution (`rawrequest run`,
  `rawrequest load`, `rawrequest mcp`).
* `mcp`: MCP server implementation exposing tools to AI assistants.
* `mockserver`: Local stateful mock server (with embedded SQLite) described in
  the [README.md](../README.md).

### Generated Go Code

`internal/app/script_cleaner_generated.go` is **generated, not hand-written**.
It is produced by `scripts/generate_script_cleaner.go` via the `go:generate`
directive at the top of `internal/app/app.go`:

```go
//go:generate go run ../../scripts/generate_script_cleaner.go
```

Run `go generate ./...` from the repo root after changing the generator, and
commit the regenerated file. Do not hand-edit
`script_cleaner_generated.go` — it carries a `DO NOT EDIT` header.

### Request Flow

1. Frontend sends `.http` content and selected requests to
   `App.ExecuteRequests()`.
2. `parsehttp.Parse()` extracts requests, variables, environments, and
   scripts.
3. `requestchain.Execute()` runs requests in dependency order.
4. For each request:
   * Pre-script executes (`< { }` block).
   * Template variables are resolved (`{{...}}`).
   * The HTTP request is sent via `httpclientlogic`.
   * The response is parsed by `responseparse`.
   * Post-script executes (`> { }` block) with response data available.
   * Variables are updated and stored in `responseStore[requestName]`.
5. Results are returned to the frontend as JSON.

## Frontend Structure (`frontend/`)

**Framework:** Angular 21 with standalone components (no NgModules).

**Key Patterns:**

* **Logic separation:** Unit-testable, deterministic logic lives in
  `*.logic.ts` files with Vitest specs (`*.spec.ts`), organized under
  `frontend/src/app/logic/` and alongside components/services by feature.
* **Components:** UI components in `*.component.ts` files orchestrate logic
  and interact with Wails bindings. Keep components under ~200 lines;
  extract distinct responsibilities into services or sub-components.
* **Service extraction:** When a component manages state or orchestrates
  complex behavior (layout, keyboard shortcuts, panel visibility, request
  execution), extract that logic into an `@Injectable` service with its own
  tests.
* **CodeMirror:** Used for `.http` file editing with custom syntax
  highlighting and linting (custom lezer grammars).

**Wails Integration:**

* Frontend calls Go via `@wailsjs/go/app/App` bindings.
* Go emits events to the frontend via `runtime.EventsEmit(ctx, eventName,
  data)` (for example, script logs are emitted as `"script-log"` events).

### `frontend/wailsjs/` — Generated Bindings

`frontend/wailsjs/` (containing `go/app/App.{d.ts,js}`, `go/models.ts`, and
`runtime/`) is **generated by the Wails CLI** from the Go `App` struct's
exported methods. It is regenerated automatically by `wails dev` / `wails
build` and by `scripts/dev-build.sh` / `scripts/build.sh`. Never hand-edit or
manually commit changes to files under `frontend/wailsjs/` — if the bindings
look stale or wrong, regenerate them by running Wails rather than editing the
generated output.

### `frontend/dist/` — Build Output Required for Go Builds

`main.go` embeds the built frontend with `//go:embed all:frontend/dist`.
`frontend/dist/` is git-ignored build output, **not** checked into the repo.
This means:

* `go build .` / `go run .` / `wails build` will fail (or embed a stale/empty
  tree) unless `frontend/dist/` has been populated first — either by running
  the frontend build (`cd frontend && npm run build`) or via `wails build`,
  which builds the frontend before compiling the Go binary.
* CI's backend job does **not** build the real frontend before running `go
  test ./...` — it creates a placeholder `frontend/dist/index.html` just to
  satisfy the `//go:embed` pattern, since backend tests don't depend on the
  actual bundled assets.
* If you only need to run backend Go tests locally without a full frontend
  build, you can create the same kind of placeholder
  (`mkdir -p frontend/dist && echo ok > frontend/dist/index.html`); for a
  real desktop build, always run the actual frontend build first.

## Development Conventions

### Backend (Go)

* **Formatting:** `gofmt` (standard Go formatting).
* **Test files:** Co-located with code as `*_test.go`.
* **Logic packages:** Pure logic in `internal/*/logic.go` with corresponding
  `logic_test.go`.
* **Platform-specific code:** Use build tags (e.g., `notify_native_darwin.go`,
  `notify_native_stub.go`, `suppress_gui_darwin.go`, `suppress_gui_windows.go`,
  `suppress_gui_stub.go`).
* **Concurrency:** Use `sync.RWMutex` for shared state (e.g., in
  `internal/app/app.go`).

### Frontend (Angular)

* **Styling:** SCSS.
* **Testing:** [Vitest](https://vitest.dev) (not Karma/Jasmine or Jest). Test
  files are `*.spec.ts` alongside the code under test. See
  [frontend/README.md](../frontend/README.md) for commands.

### Testing Standards

* **Backend unit tests:** Every core logic package in `internal/` should have
  corresponding `_test.go` files.
* **Backend integration tests:** Found in `internal/app` and
  `internal/importers` for cross-component validation.
* **Frontend unit tests:** Deterministic logic in `*.logic.ts` is tested with
  Vitest; components are tested via Angular's testing utilities where user
  interaction matters more than internal logic.

## Key Conventions

### HTTP File Format

* Requests are separated by `###` (three or more `#`).
* Directives start with `@`: `@name`, `@depends`, `@timeout`, `@load`,
  `@env.<env>.<var>`.
* Environment variables: `@env.dev.baseUrl = https://api.dev.example.com`.
* Global variables: `@token = abc123`, or declared in scripts via
  `setVar('token', 'abc123')`.
* Template syntax: `{{variableName}}`, `{{secret:password}}`,
  `{{response.login.token}}`.
* Pre-scripts: `< { /* JavaScript */ }` (runs before the request).
* Post-scripts: `> { /* JavaScript */ }` (runs after the request, has access
  to `response`).

### Script Execution Context

Scripts have access to:

* `request`: Current request object with `{ method, url, headers, body,
  name, ... }`.
* `response`: Response object with `{ status, statusText, headers, body,
  json, ... }`.
* `setVar(key, value)`: Set a variable for use in subsequent requests.
* `assert(condition, message)`: Assertion that fails the request if false.
* `console.log()`, `console.error()`: Log to the script log panel.
* `response.<requestName>`: Access the response from a named request earlier
  in the chain.

Variables set via `setVar()` do not need to be pre-declared with `@varName =`
directives.

### Secret Management

* Secrets are stored encrypted in the OS keyring (macOS Keychain, Windows
  Credential Manager, Linux Secret Service).
* Referenced in requests as `{{secret:keyName}}`.
* Managed via the UI or `SecretVault` Go code (`internal/secretvaultlogic`).

### Request Chaining

* Use `@name` to identify requests.
* Use `@depends` to declare dependencies: `@depends login, getUser`.
* Dependent requests run sequentially, accessing prior responses via
  `response.<name>.<path>`.
* Example: `Authorization: Bearer {{response.login.token}}`.

### Load Testing

* Triggered via the `@load` directive with config, e.g.:
  ```
  @load duration=60s users=100 rampUp=10s rps=500
  ```
* Results include percentile breakdowns, error rates, and timing histograms.

## Project Structure

* `main.go`: Real process entry point (CLI dispatch, Wails bootstrap, asset
  embedding). See [Entry Points](#entry-points).
* `cmd/`: Entry points for sidecar utilities (e.g., `rawrequest-updater`).
* `frontend/`: Angular source code, assets, and Wails JS bindings
  (`frontend/wailsjs/`, generated — see above).
* `internal/`: All backend logic (see [Backend Structure](#backend-structure-internal)).
* `scripts/`: Automation scripts for building, installing, and development
  (`build.sh`, `dev-build.sh`, `generate_script_cleaner.go`, `install.sh`,
  `install.ps1`, ...).
* `docs/`: This architecture doc plus the public docs site source
  (`docs/index.html`, `docs/reference.html`) published via GitHub Pages.
* `examples/`: Sample `.http` files embedded into the binary and shown in the
  app's examples picker.
