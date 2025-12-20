#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

VERSION="$1"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build/bin"
DIST_DIR="$PROJECT_ROOT/dist/releases"
TARGET_DIR="$DIST_DIR/RawRequest-$VERSION"
ARCHIVE_NAME="RawRequest-$VERSION-macos-universal.tar.gz"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"

cd "$PROJECT_ROOT"

if [[ ! -d "$BUILD_DIR/RawRequest.app" ]]; then
  echo "Missing app bundle at $BUILD_DIR/RawRequest.app. Run 'wails build' first." >&2
  exit 1
fi

# Build and embed updater helper into the app bundle
UPDATER_DST="$BUILD_DIR/RawRequest.app/Contents/MacOS/rawrequest-updater"
TMP_UPDATER_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_UPDATER_DIR"' EXIT

echo "Building rawrequest-updater (universal)..."
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o "$TMP_UPDATER_DIR/rawrequest-updater-amd64" ./cmd/rawrequest-updater
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o "$TMP_UPDATER_DIR/rawrequest-updater-arm64" ./cmd/rawrequest-updater
lipo -create -output "$UPDATER_DST" "$TMP_UPDATER_DIR/rawrequest-updater-amd64" "$TMP_UPDATER_DIR/rawrequest-updater-arm64"
chmod +x "$UPDATER_DST"

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR"/*

# Copy the app bundle
cp -R "$BUILD_DIR/RawRequest.app" "$TARGET_DIR/"

# Copy CLI binary if it exists (for CLI usage)
if [[ -x "$BUILD_DIR/RawRequest" ]]; then
  cp "$BUILD_DIR/RawRequest" "$TARGET_DIR/rawrequest"
fi

mkdir -p "$DIST_DIR"
rm -f "$ARCHIVE_PATH"
( cd "$DIST_DIR" && tar -czf "$ARCHIVE_NAME" "RawRequest-$VERSION" )

echo ""
echo "Created: $ARCHIVE_PATH"
echo "SHA-256:"
shasum -a 256 "$ARCHIVE_PATH"
