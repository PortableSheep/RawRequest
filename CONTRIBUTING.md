# Contributing

For the full architecture reference (project layout, backend/frontend
structure, entry points, generated code, and build requirements), see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites
- Go 1.24+
- Node.js 20+
- Wails CLI: https://wails.io/docs/gettingstarted/installation

## Setup
```bash
cd frontend
npm ci
cd ..
```

## Run (dev)
```bash
wails dev
```

## Tests
Backend:
```bash
go test ./...
```

Frontend ([Vitest](https://vitest.dev)):
```bash
cd frontend
npm test             # single run (vitest run)
npm run test:watch   # watch mode (vitest)
```

## Style
- Go is formatted via `gofmt`.
- Frontend code should keep unit-testable, deterministic logic in
  `*.logic.ts` modules with Vitest specs (`*.spec.ts`).
