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

# Extract CLI binary from app bundle if standalone build not available
if [[ ! -x "$BUILD_DIR/RawRequest" ]]; then
  echo "Extracting CLI binary from app bundle..."
  cp "$BUILD_DIR/RawRequest.app/Contents/MacOS/RawRequest" "$BUILD_DIR/RawRequest"
  chmod +x "$BUILD_DIR/RawRequest"
fi
cp "$BUILD_DIR/RawRequest" "$TARGET_DIR/rawrequest"

# Re-sign the standalone CLI with a distinct ad-hoc identifier so it is
# not conflated with the GUI bundle by macOS LaunchServices when running
# as `rawrequest mcp` / `rawrequest service`. The release workflow may
# layer a Developer ID signature on top of this; the --identifier sticks.
# Mirrors internal/migrations/m0002_cli_distinct_identifier_darwin.go.
if command -v codesign >/dev/null 2>&1; then
  echo "Ad-hoc resigning standalone CLI with identifier dev.rawrequest.cli..."
  codesign --force --sign - --identifier dev.rawrequest.cli "$TARGET_DIR/rawrequest"
fi
cat > "$TARGET_DIR/rawrequest-service" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/rawrequest" service "$@"
EOF
chmod +x "$TARGET_DIR/rawrequest-service"

mkdir -p "$DIST_DIR"
rm -f "$ARCHIVE_PATH"
( cd "$DIST_DIR" && tar -czf "$ARCHIVE_NAME" "RawRequest-$VERSION" )

echo ""
echo "Created: $ARCHIVE_PATH"
echo "SHA-256:"
shasum -a 256 "$ARCHIVE_PATH"
