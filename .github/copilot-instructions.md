# RawRequest - Copilot Instructions

RawRequest is a code-first desktop HTTP client built with Wails (Go backend) and Angular (TypeScript frontend). Users write requests in `.http` files with environment variables, secrets, JavaScript scripts, and request chaining.

## Build, Test, and Lint

### Backend (Go)
```bash
# Run all tests
go test ./...

# Run tests for a specific package
go test ./internal/parsehttp
go test ./internal/scriptruntime

# Run a single test
go test ./internal/parsehttp -run TestParseName

# Generate code (script cleaner)
go generate ./...
```

Go code is formatted with `gofmt` (standard Go formatting).

### Frontend (Angular + Jest)
```bash
cd frontend

# Install dependencies
npm ci

# Run all tests
npm test -- --runInBand

# Run tests for a specific file
npm test -- request.component.spec.ts

# Run tests in watch mode
npm test:watch

# Build frontend
npm run build
```

### Full Application
```bash
# Development mode (hot reload)
wails dev

# Production build
wails build
```

## Architecture

### Backend Structure

**Entry Point**: `app.go` defines the `App` struct which is the main Wails application bound to the frontend. Key responsibilities:
- Variable and environment management (`variables`, `environments`, `currentEnv`)
- Request execution orchestration
- Secret vault integration (`SecretVault`)
- Script logging via ring buffer (`scriptLogs`)
- Request cancellation tracking (`requestCancels`)

**Key Packages** (in `internal/`):
- `parsehttp`: Parses `.http` files into request objects. Handles directives like `@name`, `@env.*`, `@depends`, `@load`, and script blocks (`< { }` for pre-scripts, `> { }` for post-scripts)
- `requestchain`: Executes chained requests respecting `@depends` directives. Maintains `responseStore` for accessing prior request results
- `scriptruntime`: Provides JavaScript execution context with `ExecutionContext` containing `Request`, `Response`, `Variables`, `ResponseStore`, and `Assertions`
- `scriptexec`: Executes JavaScript using goja VM, exposes helpers like `setVar()`, `assert()`, `console.log()`
- `templating`: Resolves `{{variable}}` placeholders including special forms like `{{secret:key}}`, `{{response.name.path.to.value}}`
- `httpclientlogic`: Core HTTP client logic with timing breakdown (DNS, TCP, TLS, TTFB, content transfer)
- `loadtest`: Load testing engine with RPS limiting, adaptive spawn rates, failure rate monitoring
- `secretvaultlogic`: Encrypted secret storage using OS keyring
- `cli`: CLI mode for running requests from terminal (`rawrequest run`, `rawrequest list`)

**Request Flow**:
1. Frontend sends `.http` content and selected requests to `App.ExecuteRequests()`
2. `parsehttp.Parse()` extracts requests, variables, environments, scripts
3. `requestchain.Execute()` runs requests in dependency order
4. For each request:
   - Pre-script executes (`< { }` block)
   - Template variables resolved (`{{...}}`)
   - HTTP request sent via `httpclientlogic`
   - Response parsed by `responseparse`
   - Post-script executes (`> { }` block) with response data
   - Variables updated, stored in `responseStore[requestName]`
5. Results returned to frontend as JSON

### Frontend Structure

**Framework**: Angular 21 with standalone components (no modules)

**Key Patterns**:
- **Logic separation**: Unit-testable, deterministic logic lives in `*.logic.ts` files with Jest specs
- **Components**: UI components in `*.component.ts` files, orchestrate logic and interact with Wails bindings
- **Service-style logic**: Logic files in `frontend/src/app/logic/` organized by feature (app, active-run, history, layout, request)

**Wails Integration**: 
- Frontend calls Go via `@wailsjs/go/main/App` bindings (auto-generated)
- Go emits events to frontend via `runtime.EventsEmit(ctx, eventName, data)`
- Example: Script logs emitted as `"script-log"` events, received by frontend

**CodeMirror**: Used for `.http` file editing with custom syntax highlighting and linting

## Key Conventions

### HTTP File Format
- Requests separated by `###` (three or more `#`)
- Directives start with `@`: `@name`, `@depends`, `@timeout`, `@load`, `@env.<env>.<var>`
- Environment variables: `@env.dev.baseUrl = https://api.dev.example.com`
- Global variables: `@token = abc123` or declared in scripts via `setVar('token', 'abc123')`
- Template syntax: `{{variableName}}`, `{{secret:password}}`, `{{response.login.token}}`
- Pre-scripts: `< { /* JavaScript */ }` (runs before request)
- Post-scripts: `> { /* JavaScript */ }` (runs after request, has access to `response`)

### Script Execution Context
Scripts have access to:
- `request`: Current request object with `{ method, url, headers, body, name, ... }`
- `response`: Response object with `{ status, statusText, headers, body, json, ... }`
- `setVar(key, value)`: Set variable for use in subsequent requests
- `assert(condition, message)`: Assertion that fails request if false
- `console.log()`, `console.error()`: Log to script log panel
- `response.<requestName>`: Access response from named request (if it exists in chain)

Variables set via `setVar()` do NOT need to be pre-declared with `@varName =` directives.

### Go Code Organization
- **Test files**: Co-located with code as `*_test.go`
- **Logic packages**: Pure logic in `internal/*/logic.go` with corresponding `logic_test.go`
- **Platform-specific**: Use build tags for OS-specific code (e.g., `notify_native_darwin.go`, `notify_native_stub.go`)
- **Generated code**: `script_cleaner_generated.go` is generated via `go generate ./...` (directive in `app.go`)

### Frontend Code Organization
- **Testable logic**: Extract to `*.logic.ts` with pure functions, test with Jest
- **Component tests**: Focus on user interaction, not business logic
- **Wails bindings**: Import from `@wailsjs/go/main/App`, never commit changes to `wailsjs/` (auto-generated)

### Secret Management
- Secrets stored encrypted in OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Referenced in requests as `{{secret:keyName}}`
- Managed via UI or `SecretVault` Go code

### Request Chaining
- Use `@name` to identify requests
- Use `@depends` to declare dependencies: `@depends login, getUser`
- Dependent requests run sequentially, accessing prior responses via `response.<name>.<path>`
- Example: `Authorization: Bearer {{response.login.token}}`

### Load Testing
- Triggered via `@load` directive with config:
  ```
  @load
  duration: 60s
  users: 100
  rampUp: 10s
  targetRPS: 500
  ```
- Results include percentile breakdowns, error rates, timing histograms
