# Homebrew Distribution

These steps outline how to ship RawRequest via a dedicated Homebrew tap without App Store signing.

## 1. Build the Release Artifact

1. Ensure you have the required tooling:
   - Go toolchain (matching `go.mod`)
   - Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
   - `shasum` (macOS default)

2. Run a clean production build:
   ```bash
   wails build -platform darwin/universal -clean
   ```

3. Package the app using the helper script:
   ```bash
   ./scripts/package_homebrew.sh v1.0.0
   ```
   This creates `dist/releases/RawRequest-v1.0.0-macos-universal.tar.gz`

## 2. Publish the Artifact

1. Create a GitHub release tagged with the same version (`v1.0.0`)
2. Upload the generated tarball to the release assets
3. Copy the SHA-256 checksum from the script output

## 3. Create/Update the Tap

1. Create a tap repository: `yourusername/homebrew-rawrequest`

2. Add `Formula/rawrequest.rb`:
   ```ruby
   class Rawrequest < Formula
     desc "A modern HTTP client for developers"
     homepage "https://github.com/yourusername/RawRequest"
     version "1.0.0"
     url "https://github.com/yourusername/RawRequest/releases/download/v1.0.0/RawRequest-v1.0.0-macos-universal.tar.gz"
     sha256 "<paste checksum from script output>"

     def install
       prefix.install "RawRequest.app"
       # Optional: install CLI binary
       bin.install "rawrequest" if File.exist?("rawrequest")
     end

     def caveats
       <<~EOS
         RawRequest.app is unsigned. After installing:
         1. Run: open #{prefix}/RawRequest.app
         2. If blocked, go to System Settings → Privacy & Security → "Open Anyway"
       EOS
     end
   end
   ```

3. Commit and push the tap

## 4. User Install Flow

```bash
# Add the tap
brew tap yourusername/rawrequest

# Install
brew install rawrequest

# Launch
open $(brew --prefix)/opt/rawrequest/RawRequest.app
```

## 5. Automated Updates (Optional)

The GitHub Actions workflow at `.github/workflows/release.yml` automatically:
- Builds the universal macOS binary
- Creates the Homebrew tarball with SHA-256
- Publishes to GitHub Releases

You just need to update the tap formula with the new version and checksum.
