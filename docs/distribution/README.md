# Distribution Guide

## Building for Release

### Prerequisites

1. **Wails CLI**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
2. **Node.js**: 18+ recommended
3. **Go**: 1.21+ recommended

### Quick Build

```bash
# Build for current platform
wails build

# Build with version
./scripts/build.sh 1.0.0 all
```

---

## macOS Distribution

### Option 1: Unsigned App (Free - Recommended for Open Source)

Build and distribute the `.app` directly:

```bash
./scripts/build.sh 1.0.0 macos
```

This creates:
- `dist/RawRequest-1.0.0-macos.zip` (or `.dmg` if create-dmg is installed)

**User Installation:**
1. Download and unzip
2. Drag to Applications
3. First launch: Right-click → Open (or go to System Preferences → Security → "Open Anyway")

### Option 2: Create a DMG (Free)

Install create-dmg:
```bash
brew install create-dmg
```

Then build:
```bash
./scripts/build.sh 1.0.0 macos
```

### Option 3: Signed & Notarized (Requires Apple Developer Account - $99/year)

If you want a seamless installation experience:

1. **Get an Apple Developer Account**: https://developer.apple.com/programs/
2. **Create certificates** in Xcode → Preferences → Accounts
3. **Sign the app**:
   ```bash
   codesign --deep --force --verify --verbose \
     --sign "Developer ID Application: Your Name (TEAM_ID)" \
     ./build/bin/RawRequest.app
   ```
4. **Notarize** (required for macOS 10.15+):
   ```bash
   xcrun notarytool submit ./dist/RawRequest.dmg \
     --apple-id "your@email.com" \
     --password "app-specific-password" \
     --team-id "TEAM_ID" \
     --wait
   
   xcrun stapler staple ./dist/RawRequest.dmg
   ```

### Homebrew Distribution

See [docs/distribution/homebrew.md](homebrew.md) for Homebrew tap setup.

---

## Windows Distribution

### Option 1: Portable ZIP (Free - No Installation Required)

```bash
./scripts/build.sh 1.0.0 windows
```

Creates: `dist/RawRequest-1.0.0-windows-portable.zip`

Users just extract and run. SmartScreen warning will appear on first run.

### Option 2: NSIS Installer (Free)

Requires NSIS installed on Windows or via cross-compilation:

```bash
./scripts/build.sh 1.0.0 windows-installer
```

Creates: `dist/RawRequest-1.0.0-windows-setup.exe`

### Option 3: Signed Installer (Requires Code Signing Certificate)

For a professional experience without SmartScreen warnings, you need a code signing certificate:

- **Standard OV Certificate**: ~$200-500/year (DigiCert, Sectigo, etc.)
- **EV Certificate**: ~$400-700/year (Immediate SmartScreen trust)

Sign with:
```bash
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a RawRequest.exe
```

---

## Cross-Compilation from macOS

### Building Windows from macOS

You need a Windows cross-compiler:

```bash
# Install mingw-w64
brew install mingw-w64

# Set environment for cross-compilation
export CGO_ENABLED=1
export CC=x86_64-w64-mingw32-gcc
export CXX=x86_64-w64-mingw32-g++

# Build
wails build -platform windows/amd64
```

**Note:** Cross-compiling Windows apps from macOS can be tricky. Consider using GitHub Actions for reliable cross-platform builds.

---

## GitHub Actions CI/CD (Recommended)

For automated releases, see the included workflow at `.github/workflows/release.yml`.

This handles:
- Building for Windows, macOS (Intel + ARM)
- Creating installers
- Publishing GitHub releases
- (Optional) Notarization if secrets are configured

---

## Summary: What Do You Actually Need?

| Goal | Apple Dev Account | Windows Signing | Cost |
|------|-------------------|-----------------|------|
| **MVP / Open Source** | ❌ | ❌ | Free |
| **Smooth Mac UX** | ✅ $99/year | ❌ | $99/year |
| **Smooth Windows UX** | ❌ | ✅ ~$200+/year | $200+/year |
| **Professional Both** | ✅ | ✅ | $300+/year |

**Recommendation for starting out:** Go with unsigned builds. Most open-source apps do this successfully. Users understand the "first launch" dance on macOS, and SmartScreen warnings on Windows are common for small developers.
