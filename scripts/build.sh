#!/bin/bash

# RawRequest Build Script
# Builds for macOS (Homebrew/DMG) and Windows (Portable ZIP)

set -e

VERSION="${1:-1.0.0}"
APP_NAME="RawRequest"
BUILD_DIR="./dist"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[BUILD]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Clean previous builds
clean() {
    print_status "Cleaning previous builds..."
    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR/releases"
}

# Build for macOS (universal binary for Homebrew)
build_macos() {
    print_status "Building for macOS (universal)..."
    
    wails build -platform darwin/universal -clean -ldflags "-X main.Version=$VERSION"
    
    # Package for Homebrew
    print_status "Packaging for Homebrew..."
    ./scripts/package_homebrew.sh "v$VERSION"
    
    # Create DMG if create-dmg is available
    if command -v create-dmg &> /dev/null; then
        print_status "Creating DMG..."
        create-dmg \
            --volname "$APP_NAME" \
            --window-pos 200 120 \
            --window-size 600 400 \
            --icon-size 100 \
            --icon "$APP_NAME.app" 175 120 \
            --hide-extension "$APP_NAME.app" \
            --app-drop-link 425 120 \
            "$BUILD_DIR/releases/${APP_NAME}-${VERSION}-macos.dmg" \
            "./build/bin/${APP_NAME}.app" || print_warning "DMG creation failed, tarball still available"
    else
        print_warning "create-dmg not found. Install with: brew install create-dmg"
        print_status "Homebrew tarball is still available in dist/releases/"
    fi
    
    print_status "macOS build complete!"
}

# Build for Windows (portable ZIP only)
build_windows() {
    print_status "Building for Windows..."
    
    # Check for Windows cross-compilation
    if [[ "$OSTYPE" == "darwin"* ]]; then
        print_warning "Cross-compiling to Windows from macOS..."
        export CGO_ENABLED=1
        export CC=x86_64-w64-mingw32-gcc
        export CXX=x86_64-w64-mingw32-g++
        
        if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
            print_error "mingw-w64 not found. Install with: brew install mingw-w64"
            print_warning "Alternatively, use GitHub Actions for Windows builds"
            return 1
        fi
    fi
    
    wails build -platform windows/amd64 -ldflags "-X main.Version=$VERSION"
    
    # Build updater helper with UAC elevation manifest
    print_status "Building updater helper..."
    build_windows_updater

    # Create portable ZIP (still useful for users who prefer it)
    print_status "Creating portable ZIP..."
    mkdir -p "$BUILD_DIR/releases/portable"
    cp "./build/bin/${APP_NAME}.exe" "$BUILD_DIR/releases/portable/"
    cp "./build/bin/rawrequest-updater.exe" "$BUILD_DIR/releases/portable/"
    
    cat > "$BUILD_DIR/releases/portable/README.txt" << EOF
$APP_NAME - Portable Edition
Version: $VERSION

Simply run ${APP_NAME}.exe to start the application.

Note: On first run, Windows SmartScreen may show a warning.
Click "More info" then "Run anyway" to proceed.

For auto-updates to work, keep rawrequest-updater.exe in the same folder.
EOF
    
    cd "$BUILD_DIR/releases"
    zip -r "${APP_NAME}-${VERSION}-windows-portable.zip" "portable"
    rm -rf "portable"
    cd "$PROJECT_ROOT"

    # Create Windows installer
    build_windows_installer
    
    print_status "Windows build complete!"
}

# Build Windows updater with UAC elevation manifest embedded
build_windows_updater() {
    local UPDATER_DIR="./cmd/rawrequest-updater"
    
    # Check if go-winres is installed for embedding manifest
    if command -v go-winres &> /dev/null; then
        print_status "Generating Windows resource file with UAC manifest..."
        cd "$UPDATER_DIR"
        go-winres make --arch amd64
        cd "$PROJECT_ROOT"
        
        # Build with embedded manifest
        CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o "./build/bin/rawrequest-updater.exe" ./cmd/rawrequest-updater
        
        # Clean up generated .syso file
        rm -f "$UPDATER_DIR"/*.syso
    else
        print_warning "go-winres not found. Building updater without UAC manifest."
        print_warning "Install with: go install github.com/tc-hib/go-winres@latest"
        print_warning "Without the manifest, updates to Program Files will require manual elevation."
        
        # Build without manifest (will still work, but won't auto-elevate)
        CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o "./build/bin/rawrequest-updater.exe" ./cmd/rawrequest-updater
    fi
}

# Build Windows installer using NSIS
build_windows_installer() {
    print_status "Creating Windows installer..."
    
    # Check if NSIS is available
    if ! command -v makensis &> /dev/null; then
        print_warning "NSIS not found. Skipping installer creation."
        print_warning "Install NSIS to create Windows installer:"
        print_warning "  macOS: brew install nsis"
        print_warning "  Windows: choco install nsis or download from https://nsis.sourceforge.io"
        print_warning "  Linux: apt install nsis"
        return 0
    fi
    
    # Create staging directory for installer
    mkdir -p "$BUILD_DIR/releases/installer-staging"
    cp "./build/bin/${APP_NAME}.exe" "$BUILD_DIR/releases/installer-staging/"
    cp "./build/bin/rawrequest-updater.exe" "$BUILD_DIR/releases/installer-staging/"
    
    # Run NSIS
    print_status "Running NSIS..."
    makensis -DVERSION="$VERSION" "./build/windows/installer.nsi"
    
    # Cleanup staging
    rm -rf "$BUILD_DIR/releases/installer-staging"
    
    if [[ -f "$BUILD_DIR/releases/${APP_NAME}-${VERSION}-windows-setup.exe" ]]; then
        print_status "Windows installer created: ${APP_NAME}-${VERSION}-windows-setup.exe"
    else
        print_warning "Installer creation may have failed. Check NSIS output above."
    fi
}

# Show usage
usage() {
    echo "RawRequest Build Script"
    echo ""
    echo "Usage: $0 [version] [target]"
    echo ""
    echo "Targets:"
    echo "  all        Build for macOS and Windows"
    echo "  macos      Build for macOS (universal binary + DMG)"
    echo "  windows    Build for Windows (installer + portable ZIP)"
    echo "  clean      Clean build artifacts"
    echo ""
    echo "Examples:"
    echo "  $0 1.0.0 all      # Build everything"
    echo "  $0 1.0.0 macos    # Build macOS only"
    echo "  $0 1.0.0 windows  # Build Windows only"
    echo ""
    echo "Windows installer requires NSIS:"
    echo "  macOS:   brew install nsis"
    echo "  Windows: choco install nsis"
    echo "  Linux:   apt install nsis"
}

# Main
main() {
    local target="${2:-all}"
    
    cd "$PROJECT_ROOT"
    
    echo ""
    print_status "Building $APP_NAME v$VERSION"
    print_status "Target: $target"
    echo ""
    
    case "$target" in
        all)
            clean
            build_macos
            build_windows
            ;;
        macos)
            clean
            build_macos
            ;;
        windows)
            clean
            build_windows
            ;;
        clean)
            clean
            ;;
        -h|--help|help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 1
            ;;
    esac
    
    echo ""
    print_status "Build complete! Artifacts:"
    ls -la "$BUILD_DIR/releases/" 2>/dev/null || true
}

main "$@"
