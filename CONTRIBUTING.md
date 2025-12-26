# Contributing

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

Frontend:
```bash
cd frontend
npm test -- --runInBand
```

## Style
- Go is formatted via `gofmt`.
- Frontend code should keep unit-testable, deterministic logic in `*.logic.ts` modules with Jest specs.
