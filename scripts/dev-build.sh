#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$PROJECT_ROOT/build/bin/RawRequest.app"
CLI_LINK="/usr/local/bin/rawrequest"
CLI_TARGET="$APP_BUNDLE/Contents/MacOS/RawRequest"

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[DEV]${NC} Building RawRequest (dev)..."
cd "$PROJECT_ROOT"
wails build -ldflags "-X main.Version=dev"

echo -e "${GREEN}[DEV]${NC} Symlinking $CLI_LINK -> $CLI_TARGET"
sudo ln -sf "$CLI_TARGET" "$CLI_LINK"

echo -e "${GREEN}[DEV]${NC} Done! Verify with:"
echo "  rawrequest version"
echo "  rawrequest mcp"
