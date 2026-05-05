# RawRequest

**Code-first HTTP client.** Write requests in `.http` files. Run them from the terminal, your AI assistant, or a full desktop GUI.

## Project Overview

RawRequest is a multi-mode HTTP client platform consisting of a Go backend and an Angular frontend. It supports executing `.http` files with advanced features like variable interpolation, environment management, request chaining, pre/post scripts, and load testing.

### Architecture

The project is structured as a single Go binary that operates in three distinct modes:

1.  **Desktop Mode (Wails):** A desktop GUI built with Angular and Wails.
2.  **CLI Mode:** Command-line tools for running requests (`run`) and load tests (`load`).
3.  **MCP Mode:** An MCP (Model Context Protocol) server for integration with AI assistants.

### Key Technologies

*   **Backend:** Go (1.25+), Wails v2, Goja (JavaScript execution), MCP-go.
*   **Frontend:** Angular (v21+), CodeMirror 6, Vitest.
*   **Data Format:** Enhanced `.http` files (JetBrains/VS Code style with extensions).

---

## Building and Running

### Prerequisites

*   **Go:** 1.25+
*   **Node.js:** 20+
*   **Wails CLI:** [Installation Guide](https://wails.io/docs/gettingstarted/installation)

### Key Commands

| Task | Command |
| :--- | :--- |
| **Setup** | `cd frontend && npm install` |
| **Dev Mode** | `./scripts/dev-build.sh` (Starts Wails dev + background service) |
| **Build (All)** | `./scripts/build.sh` |
| **Build CLI Only** | `go build -o rawrequest .` |
| **Test Backend** | `go test ./...` |
| **Test Frontend** | `cd frontend && npm test` |

---

## Development Conventions

### Backend (Go)

*   **Logic Isolation:** Core logic (parsing, execution, templating) is located in `internal/` subpackages to be shared across CLI, MCP, and Desktop modes.
    *   `internal/httpclientlogic`: Low-level HTTP execution.
    *   `internal/requestchain`: Handles `@depends` and sequential execution.
    *   `internal/scriptexec`: JavaScript integration via Goja.
    *   `internal/templating`: `{{var}}` and `{{secret:key}}` resolution.
*   **Concurrency:** Use `sync.RWMutex` for shared state (e.g., in `internal/app/app.go`).
*   **Wails Binding:** The `App` struct in `internal/app/app.go` is the primary bridge between Go and the Angular frontend.

### Frontend (Angular)

*   **Styling:** SCSS is used for styling.
*   **Editor:** CodeMirror 6 is used for the `.http` editor, with custom lezer grammars for syntax highlighting.
*   **Testing:** Vitest is used instead of Karma/Jasmine for faster unit testing.

### Testing Standards

*   **Unit Tests:** Every core logic package in `internal/` should have corresponding `_test.go` files.
*   **Integration Tests:** Found in `internal/app` and `internal/importers` for cross-component validation.

---

## Project Structure

*   `cmd/`: Entry points for sidecar utilities (e.g., `rawrequest-updater`).
*   `frontend/`: Angular source code, assets, and Wails JS bindings.
*   `internal/`:
    *   `app/`: Desktop application state and Wails bridge.
    *   `cli/`: CLI argument parsing and runner logic.
    *   `mcp/`: MCP server implementation.
    *   `httpclientlogic/`, `requestchain/`, `scriptexec/`, `templating/`: Core execution engine.
*   `scripts/`: Automation scripts for building, installing, and development.
