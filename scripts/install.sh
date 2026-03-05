#!/bin/bash
# RawRequest macOS Installation Script
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/portablesheep/RawRequest/main/scripts/install.sh | bash
#
# Or with a specific version:
#   curl -fsSL https://raw.githubusercontent.com/portablesheep/RawRequest/main/scripts/install.sh | bash -s -- v1.0.0

set -e

REPO="portablesheep/RawRequest"
VERSION="${1:-latest}"
INSTALL_DIR="/Applications"
BIN_DIR="${RAWREQUEST_BIN_DIR:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

trap 'echo -e "\n${RED}Error: Installation failed at line $LINENO. Run with \"bash -x\" for details.${NC}" >&2' ERR

echo -e "${GREEN}Installing RawRequest...${NC}"

# Check OS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}Error: This installer only supports macOS.${NC}"
    echo "For Windows, use the PowerShell installer:"
    echo "  irm https://raw.githubusercontent.com/${REPO}/main/scripts/install.ps1 | iex"
    exit 1
fi

if [ -z "$BIN_DIR" ]; then
    for candidate in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
        if [[ ":$PATH:" == *":$candidate:"* ]]; then
            BIN_DIR="$candidate"
            break
        fi
    done
fi

if [ -z "$BIN_DIR" ]; then
    BIN_DIR="/usr/local/bin"
fi

USE_SUDO=1
if [[ "$BIN_DIR" == "$HOME/"* ]]; then
    USE_SUDO=0
fi

run_install_cmd() {
    if [ "$USE_SUDO" -eq 1 ]; then
        sudo "$@"
    else
        "$@"
    fi
}

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

# Create CLI symlink so 'rawrequest' is available on PATH
run_install_cmd mkdir -p "$BIN_DIR"
CLI_LINK="$BIN_DIR/rawrequest"
CLI_TARGET="$INSTALL_DIR/RawRequest.app/Contents/MacOS/RawRequest"
echo "Creating CLI symlink at $CLI_LINK..."
if [ -L "$CLI_LINK" ] || [ -e "$CLI_LINK" ]; then
    run_install_cmd rm -f "$CLI_LINK"
fi
run_install_cmd ln -s "$CLI_TARGET" "$CLI_LINK"

# Verify the symlink target exists
if [ ! -x "$CLI_TARGET" ]; then
    echo -e "${RED}Error: CLI binary not found at $CLI_TARGET${NC}"
    echo "The app bundle may be incomplete. Try reinstalling."
    exit 1
fi

# Install a service launcher command for split architecture workflows.
SERVICE_CMD="$BIN_DIR/rawrequest-service"
SERVICE_SCRIPT="$TMP_DIR/rawrequest-service"
cat > "$SERVICE_SCRIPT" << 'EOF'
#!/bin/bash
set -euo pipefail
exec "__RAWREQUEST_CLI_LINK__" service "$@"
EOF
sed -i.bak "s|__RAWREQUEST_CLI_LINK__|$CLI_LINK|g" "$SERVICE_SCRIPT"
rm -f "$SERVICE_SCRIPT.bak"
chmod +x "$SERVICE_SCRIPT"
echo "Creating service launcher at $SERVICE_CMD..."
run_install_cmd install -m 755 "$SERVICE_SCRIPT" "$SERVICE_CMD"

echo -e "${GREEN}✓ RawRequest installed successfully!${NC}"
echo ""
echo "To open RawRequest:"
echo "  open /Applications/RawRequest.app"
echo ""
echo "CLI usage:"
echo "  rawrequest run api.http -n login"
echo "  rawrequest mcp"
echo "  rawrequest service"
echo "  rawrequest-service"

# Verify the CLI is actually discoverable in the user's default login shell.
# The install-time bash PATH may differ from the user's interactive shell.
USER_SHELL="${SHELL:-/bin/zsh}"
if ! "$USER_SHELL" -lc "command -v rawrequest" >/dev/null 2>&1; then
    echo ""
    echo -e "${YELLOW}Warning:${NC} rawrequest is not on PATH in your shell ($(basename "$USER_SHELL"))."
    echo "The symlink was created at: $CLI_LINK"
    echo ""
    SHELL_NAME="$(basename "$USER_SHELL")"
    case "$SHELL_NAME" in
        zsh)
            PROFILE="$HOME/.zshrc"
            ;;
        bash)
            PROFILE="$HOME/.bash_profile"
            ;;
        fish)
            PROFILE="$HOME/.config/fish/config.fish"
            ;;
        *)
            PROFILE="your shell profile"
            ;;
    esac
    if [ "$SHELL_NAME" = "fish" ]; then
        echo "Add this to $PROFILE:"
        echo "  fish_add_path $BIN_DIR"
    else
        echo "Add this to $PROFILE:"
        echo "  export PATH=\"$BIN_DIR:\$PATH\""
    fi
    echo ""
    echo "Then restart your terminal or run:"
    if [ "$SHELL_NAME" = "fish" ]; then
        echo "  source $PROFILE"
    else
        echo "  source $PROFILE"
    fi
fi
echo ""
echo "Or find it in your Applications folder."
