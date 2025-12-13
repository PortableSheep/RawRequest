#!/bin/bash
# RawRequest Homebrew Installation Script
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yourusername/RawRequest/main/scripts/install.sh | bash
#
# Or with a specific version:
#   curl -fsSL https://raw.githubusercontent.com/yourusername/RawRequest/main/scripts/install.sh | bash -s -- v1.0.0

set -e

REPO="portablesheep/RawRequest"
VERSION="${1:-latest}"
INSTALL_DIR="/Applications"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Installing RawRequest...${NC}"

# Check OS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This installer only supports macOS.${NC}"
    echo "For Windows, download the portable ZIP from:"
    echo "https://github.com/${REPO}/releases"
    exit 1
fi

# Get latest version if not specified
if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$VERSION" ]; then
        echo -e "${RED}Error: Could not determine latest version.${NC}"
        exit 1
    fi
fi

echo "Version: $VERSION"

# Create temp directory
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Download
TARBALL_URL="https://github.com/${REPO}/releases/download/${VERSION}/RawRequest-${VERSION}-macos-universal.tar.gz"
echo "Downloading from: $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$TMP_DIR/rawrequest.tar.gz"

# Extract
echo "Extracting..."
tar -xzf "$TMP_DIR/rawrequest.tar.gz" -C "$TMP_DIR"

# Find the app
APP_PATH=$(find "$TMP_DIR" -name "RawRequest.app" -type d | head -1)
if [ -z "$APP_PATH" ]; then
    echo -e "${RED}Error: RawRequest.app not found in archive.${NC}"
    exit 1
fi

# Install
echo "Installing to $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/RawRequest.app" ]; then
    echo -e "${YELLOW}Removing existing installation...${NC}"
    rm -rf "$INSTALL_DIR/RawRequest.app"
fi

cp -R "$APP_PATH" "$INSTALL_DIR/"

# Remove quarantine attribute
xattr -dr com.apple.quarantine "$INSTALL_DIR/RawRequest.app" 2>/dev/null || true

echo -e "${GREEN}✓ RawRequest installed successfully!${NC}"
echo ""
echo "To open RawRequest:"
echo "  open /Applications/RawRequest.app"
echo ""
echo "Or find it in your Applications folder."
