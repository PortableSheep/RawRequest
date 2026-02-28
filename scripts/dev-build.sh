#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_BIN="$PROJECT_ROOT/rawrequest"
CLI_LINK="${RAWREQUEST_CLI_LINK:-/usr/local/bin/rawrequest}"
SERVICE_ADDR="${RAWREQUEST_SERVICE_ADDR:-127.0.0.1:7345}"
SERVICE_LOG="${TMPDIR:-/tmp}/rawrequest-dev-service.log"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MODE="all"
DO_LINK=1
SERVICE_PID=""

if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "scripts/dev-build.sh currently supports macOS development only." >&2
  exit 1
fi

usage() {
  cat <<'EOF'
RawRequest dev script

Usage:
  scripts/dev-build.sh [--build-only|--run-only|--service-only|--ui-only] [--service-addr <host:port>] [--no-link]

Modes:
  (default)       Build CLI + app, wire CLI link, run service + wails dev
  --build-only    Build CLI + app, wire CLI link, then exit
  --run-only      Run service + wails dev without rebuilding
  --service-only  Run service only (foreground)
  --ui-only       Run wails dev only

Flags:
  --service-addr  Override service bind address (default: 127.0.0.1:7345)
  --no-link       Skip writing / refreshing rawrequest CLI symlink
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) MODE="build" ;;
    --run-only) MODE="run" ;;
    --service-only) MODE="service" ;;
    --ui-only) MODE="ui" ;;
    --no-link) DO_LINK=0 ;;
    --service-addr)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --service-addr" >&2
        exit 1
      fi
      SERVICE_ADDR="$1"
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

build_cli() {
  echo -e "${GREEN}[DEV]${NC} Building rawrequest CLI binary..."
  cd "$PROJECT_ROOT"
  go build -ldflags "-X main.Version=dev" -o "$CLI_BIN" .
}

build_app() {
  echo -e "${GREEN}[DEV]${NC} Building RawRequest desktop app (wails)..."
  cd "$PROJECT_ROOT"
  wails build -ldflags "-X main.Version=dev"
}

link_cli() {
  if [[ $DO_LINK -eq 0 ]]; then
    return
  fi
  if [[ ! -x "$CLI_BIN" ]]; then
    echo "Missing CLI binary at $CLI_BIN" >&2
    exit 1
  fi
  # Remove stale symlink if target differs or is broken
  if [[ -L "$CLI_LINK" ]]; then
    local current_target
    current_target="$(readlink "$CLI_LINK" 2>/dev/null || true)"
    if [[ "$current_target" != "$CLI_BIN" ]]; then
      echo -e "${YELLOW}[DEV]${NC} Updating stale symlink $CLI_LINK"
      echo "  was: $current_target"
      echo "  now: $CLI_BIN"
      sudo rm -f "$CLI_LINK"
      sudo ln -s "$CLI_BIN" "$CLI_LINK"
    else
      echo -e "${GREEN}[DEV]${NC} Symlink $CLI_LINK already correct"
    fi
  elif [[ -e "$CLI_LINK" ]]; then
    echo -e "${YELLOW}[DEV]${NC} $CLI_LINK exists but is not a symlink; replacing"
    sudo rm -f "$CLI_LINK"
    sudo ln -s "$CLI_BIN" "$CLI_LINK"
  else
    echo -e "${GREEN}[DEV]${NC} Creating symlink $CLI_LINK -> $CLI_BIN"
    sudo ln -s "$CLI_BIN" "$CLI_LINK"
  fi
}

cleanup() {
  if [[ -n "$SERVICE_PID" ]] && kill -0 "$SERVICE_PID" 2>/dev/null; then
    echo -e "${YELLOW}[DEV]${NC} Stopping service PID $SERVICE_PID"
    kill "$SERVICE_PID" 2>/dev/null || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
}

start_service_background() {
  if [[ ! -x "$CLI_BIN" ]]; then
    echo "Missing CLI binary at $CLI_BIN. Run without --run-only first." >&2
    exit 1
  fi
  echo -e "${GREEN}[DEV]${NC} Starting service at http://$SERVICE_ADDR (logs: $SERVICE_LOG)"
  : > "$SERVICE_LOG"
  "$CLI_BIN" service --addr "$SERVICE_ADDR" >>"$SERVICE_LOG" 2>&1 &
  SERVICE_PID=$!
  sleep 1
  if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    echo "Service failed to start; recent logs:" >&2
    tail -n 40 "$SERVICE_LOG" >&2 || true
    exit 1
  fi
}

run_service_foreground() {
  if [[ ! -x "$CLI_BIN" ]]; then
    echo "Missing CLI binary at $CLI_BIN. Run --build-only first." >&2
    exit 1
  fi
  echo -e "${GREEN}[DEV]${NC} Starting service at http://$SERVICE_ADDR"
  exec "$CLI_BIN" service --addr "$SERVICE_ADDR"
}

run_ui() {
  echo -e "${GREEN}[DEV]${NC} Starting Wails dev UI..."
  cd "$PROJECT_ROOT"
  wails dev
}

case "$MODE" in
  all)
    build_cli
    build_app
    link_cli
    trap cleanup EXIT INT TERM
    start_service_background
    echo -e "${GREEN}[DEV]${NC} Service ready at http://$SERVICE_ADDR"
    echo -e "${GREEN}[DEV]${NC} rawrequest mcp / rawrequest service available via $CLI_LINK"
    run_ui
    ;;
  build)
    build_cli
    build_app
    link_cli
    echo -e "${GREEN}[DEV]${NC} Done."
    echo "  rawrequest version"
    echo "  rawrequest mcp --help"
    ;;
  run)
    trap cleanup EXIT INT TERM
    start_service_background
    echo -e "${GREEN}[DEV]${NC} Service ready at http://$SERVICE_ADDR"
    run_ui
    ;;
  service)
    run_service_foreground
    ;;
  ui)
    run_ui
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac
