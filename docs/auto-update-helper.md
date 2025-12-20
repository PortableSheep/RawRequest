# Auto-update helper (Go) — design note + spike plan

## Context (current state)
RawRequest currently:
- Checks GitHub Releases for a newer version via `(*App) CheckForUpdates()` in `update_checker.go`.
- Notifies in the UI (Angular `UpdateService`) and can open the release URL.

There is **no** automated download/apply flow yet.

## Goal
Add an **optional** auto-update capability by introducing a **separate Go helper executable** (“updater”) whose only job is:
- Downloading a specific release artifact
- Verifying integrity/authenticity
- Applying the update safely (swap binaries / app bundle)
- Relaunching RawRequest

The main app should remain unprivileged and “UI + orchestration”; the updater is the only process that performs file replacement.

## Non-goals (initially)
- Delta/patch updates (full-bundle update only)
- Background silent updates (explicit user action is fine)
- Complex privileged install frameworks (e.g. SMJobBless) on day 1

## High-level architecture

### Components
1) **RawRequest app (main)**
- Checks for updates.
- Chooses the correct platform artifact.
- Presents the user a single action: “Update and restart”.
- Launches the updater helper with all required parameters.

2) **Updater helper (new Go binary)**
- Runs as a separate process.
- Waits for the main app to exit (by PID).
- Downloads + verifies the update.
- Swaps the installation in-place.
- Relaunches the updated app.

### Why a helper is needed
A running process generally cannot replace its own binary (and on macOS, replacing a running `.app` bundle in-place is also problematic). A helper avoids self-replacement and makes updates more reliable.

## Update artifact strategy

### Option A (recommended): signed manifest + platform artifacts
Publish, per release:
- `rawrequest-update.json` (manifest)
- macOS artifact: `RawRequest-<version>-macos.zip` (a zipped `.app` bundle)
- Windows artifact: `RawRequest-<version>-windows-portable.zip`

Manifest example:
```json
{
  "version": "1.2.3",
  "publishedAt": "2025-12-17T00:00:00Z",
  "notes": "...",
  "assets": {
    "darwin_amd64": { "url": "...", "sha256": "..." },
    "darwin_arm64": { "url": "...", "sha256": "..." },
    "windows_amd64": { "url": "...", "sha256": "..." }
  },
  "signature": "<ed25519 signature over canonical json>"
}
```
Security model:
- Embed an Ed25519 public key in RawRequest and in the updater.
- The updater refuses any manifest without a valid signature.
- The updater verifies the downloaded file’s SHA-256 matches the manifest.

This avoids trusting GitHub API responses alone and prevents attacker-controlled downloads.

### Option B: direct GitHub Release asset selection (fastest prototype)
For a spike, the app can call GitHub API, find the asset URL that matches the platform, then pass it to the updater along with an expected SHA-256.
- Still recommend signing the SHA-256 values (or using a signed manifest) before shipping.

## Platform application logic

### macOS (Wails `.app` bundle)
**Key constraints**
- Replacing `/Applications/RawRequest.app` may require admin rights.
- Atomic swap is safest: rename current bundle aside, move new bundle into place.

**Proposed flow**
1) Updater downloads `RawRequest-<version>-macos.zip` to a staging directory.
2) Unzip to a staging `.app` bundle.
3) Verify:
   - Signature/manifest + sha256
   - The unzipped bundle has expected structure
4) Wait for RawRequest to exit (PID) or request it to quit (main app does this).
5) Swap:
   - Rename existing `RawRequest.app` → `RawRequest.app.bak-<timestamp>`
   - Move staged `RawRequest.app` into place
6) Launch the new app.

**Staging on the same volume**
`os.Rename` is only atomic within the same filesystem. Staging should be placed in the same parent directory when possible.
- If updating under `/Applications`, stage under `/Applications/.rawrequest-staging/…`.

**Privilege options**
- MVP: only auto-update when the install location is user-writable (e.g. `~/Applications/RawRequest.app`).
- Next: use `osascript` (“administrator privileges”) to perform the swap when installed in `/Applications`.
  - This is pragmatic but not as robust as a blessed privileged helper.
- Long-term: SMJobBless-based privileged helper (most reliable; more complex and needs careful signing + entitlements).

**Notarization/signing**
- The *new* app bundle should already be signed + notarized (as you do for releases).
- The updater binary itself must also be code-signed; if embedded inside the app bundle, it should be signed as part of the app.

### Windows (portable zip)
**Constraints**
- Cannot replace a running `.exe` reliably.

**Proposed flow**
1) Updater downloads `RawRequest-<version>-windows-portable.zip`.
2) Extract to staging directory adjacent to current install directory.
3) Wait for RawRequest.exe to exit (PID).
4) Swap:
   - Rename current directory to `RawRequest.old-<timestamp>`
   - Rename/move staging directory to the install directory
5) Relaunch `RawRequest.exe`.

Rollback:
- Keep `.old-*` directory until next successful launch.

### Homebrew installs (macOS)
If the app is installed under Homebrew cellar or symlinked:
- Strongly prefer: show “Update via Homebrew (`brew upgrade rawrequest`)”.
- In-app self-update should be disabled for that install type to avoid fighting the package manager.

## Updater CLI contract
The main app should launch the updater with explicit parameters.

Example:
```
rawrequest-updater \
  --pid=<rawrequest_pid> \
  --platform=darwin_arm64 \
  --install-path=/Applications/RawRequest.app \
  --artifact-url=https://.../RawRequest-1.2.3-macos.zip \
  --sha256=<hex> \
  --manifest-url=https://.../rawrequest-update.json \
  --relaunch
```

Notes:
- The updater should be able to operate with either `--manifest-url` or `--artifact-url + --sha256`.
- The updater should write a small log file in a predictable location for troubleshooting (e.g. temp dir).

## Failure modes and rollback strategy
Minimum viable rollback:
- Keep the previous install as `.bak-*` / `.old-*`.
- If swap fails, restore immediately.
- If relaunch fails, keep backup; the next manual launch can recover.

More robust (later):
- Use a “handoff file” protocol:
  - Updater writes `update_pending.json`.
  - Updated app, on successful start, writes `update_success.json`.
  - Updater, if still running, can clean backups only after success.

## Integration points in this repo (future)
- Extend `update_checker.go` to also fetch an update manifest (or asset list).
- Add new Wails bindings:
  - `DownloadAndApplyUpdate(...)` or `StartUpdate(...)` that launches the updater.
- Frontend:
  - Add an “Update and restart” action in the existing notification UI.

## Spike plan (concrete steps)

### Spike 0: inventory + constraints (0.5 day)
- Confirm current release artifacts naming (macOS: `.dmg`/`.tar.gz`/`.zip`, Windows: `.zip`).
- Decide the exact artifact format for auto-update (recommend `.zip` for both platforms).
- Decide install-location behavior:
  - user-writable only initially vs admin prompt.

### Spike 1: signed manifest pipeline (1 day)
- Add a small release-time script that generates `rawrequest-update.json` with asset URLs + SHA-256.
- Sign the manifest using an Ed25519 private key kept in CI secrets.
- Publish manifest as a GitHub Release asset.

### Spike 2: updater helper (macOS happy path) (1–2 days)
- Implement `rawrequest-updater` Go program:
  - download → verify sha256 → unzip → wait for PID exit → swap bundle → relaunch
- Target: update a user-writable install location first (e.g. `~/Applications`).
- Produce clear logs on failure.

### Spike 3: privilege story (macOS `/Applications`) (1–2 days)
- Option 1 (pragmatic): `osascript` admin prompt to run the swap operation.
- Option 2 (robust): SMJobBless design + prototype (more time).

### Spike 4: Windows update flow (1–2 days)
- Implement zip extract + directory swap + relaunch.
- Keep `.old-*` as rollback.

### Spike 5: Wails integration + UX (1–2 days)
- Wire a new Wails method to launch updater and quit the app.
- Hook into current Angular update notification to trigger update.

### Exit criteria
- Can update macOS user-writable install without manual steps.
- Can update Windows portable install without manual steps.
- Manifest verification is enforced.

---

If you want, I can follow this with an implementation spike that adds the updater binary (as a new Go `cmd/rawrequest-updater`), plus the minimal Wails method + UI action to invoke it.
