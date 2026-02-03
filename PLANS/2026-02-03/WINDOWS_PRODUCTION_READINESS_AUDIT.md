# Windows Production-Readiness Audit (Native Windows + WSL)
Date: 2026-02-03

This audit is a repo-wide “what breaks on Windows?” pass, based on:
- PR #602 (Windows support + `WINDOWS_BUILD_GUIDE.md`)
- The current codebase in `claude-orchestrator-dev`

Scope: **Windows + WSL/Linux differences** (ignore macOS for now).

## TL;DR status

- ✅ **Core PTY sessions can run on native Windows** (PowerShell via `node-pty`) with PR #602.
- ✅ **Tauri v2 builds are unblocked** (icon, glob patterns, backend-spawn flow).
- ⚠️ **Several non-PTY features still assume Linux paths/tools**, so “Windows supported” is **not** yet true repo-wide without additional fixes (listed below).

## Two “modes” we must support explicitly

### A) Native Windows (recommended for product)
Goal: app works on Windows with no WSL dependency.
- Terminals: PowerShell (ConPTY)
- Tooling: Git for Windows, GitHub CLI (optional), Claude Code/Codex CLIs (optional)
- Packaging: Tauri installer (`.msi` / NSIS) should bundle backend + Node runtime

### B) WSL/Linux (power-user/dev)
Goal: existing bash-first workflows stay intact.
- Terminals: bash
- Tooling: standard Linux CLI set (`lsof`, `ss`, `ffmpeg`, etc.) often available

Important: These two modes are **not the same**. Some current features silently rely on Linux-only utilities; we should either:
- implement Windows equivalents, or
- degrade gracefully with explicit “Windows requires WSL for this feature” messaging.

## What PR #602 covers (✅)

### PTY shell selection + line endings
- `server/sessionManager.js`: chooses PowerShell on win32; builds args appropriately; keeps bash sessions open on Linux.
- `server/commanderService.js`: PowerShell interactive mode + `\r\n` input conversion + duplicate auto-start guards.

### Tauri v2 build stability
- `src-tauri/tauri.conf.json`: resource glob fixes + valid `.ico`
- `src-tauri/build.rs`: avoids tracking massive folders (prevents stack overflow)
- `src-tauri/src/main.rs`: Tauri v2-safe backend kill-on-exit wiring

### Build-production on Windows
- `server/index.js`: explicitly fails fast for the current `.sh` build script on win32 (clear message).

## Hard Windows blockers (must fix for “native Windows supported”)

### 1) `process.env.HOME` assumptions (can crash on Windows)
On Windows, `HOME` is often unset (the canonical env is usually `USERPROFILE`).
Some code currently does `path.join(process.env.HOME, ...)` which can throw.

Known hotspots:
- `server/conversationService.js` (Claude/Codex history indexing)
- `server/sessionRecoveryService.js` (recovery dir defaults)
- `server/portRegistry.js` (port labels path defaults)
- a few `~` expansions (e.g. `server/greenfieldService.js`)

Fix direction:
- Centralize `homeDir = process.env.HOME || os.homedir()` and use it everywhere.
- Prefer explicit config/env overrides for history roots (future-proofing).

### 2) Port availability + “Ports” features rely on Linux-only tools
Examples:
- `server/portRegistry.js` uses `lsof` for “is port free?” (Windows has no `lsof` by default).
- `server/portRegistry.js` uses `ss`/`netstat -tlnp` for scanning listening ports (Windows `netstat` flags differ).

Fix direction:
- For “is port free?”, replace with a Node-only bind test (`net.Server.listen`).
- For “scan all ports”, implement a Windows strategy (e.g. `netstat -ano`) or explicitly mark the feature WSL-only.

### 3) Commands injected into PTYs often assume bash syntax
Example:
- `server/index.js` `server-control:start` currently sends `NODE_ENV=... PORT=... hytopia start` which is **bash syntax**, not PowerShell.

Fix direction:
- Create a tiny helper for “set env + run command” that outputs:
  - bash: `FOO=bar BAZ=qux cmd ...`
  - PowerShell: `$env:FOO='bar'; $env:BAZ='qux'; cmd ...`
- Use it anywhere the backend writes command strings into sessions.

## Windows “soft blockers” (works, but UX will be rough)

### Developer-from-source install friction (node-pty native build)
Building node-pty on Windows requires:
- Visual Studio (C++ workload)
- Windows SDK
- Spectre-mitigated libs

This is acceptable for contributors, but **not acceptable as an end-user requirement**.

Fix direction:
- End-users should install a shipped Tauri installer containing compiled deps (no build tools).
- Optional improvement: switch to a prebuilt node-pty package for contributor UX (evaluate impact/risk).

### Optional tools (should degrade cleanly)
Some features depend on tools that won’t exist on all Windows machines:
- `gh` (PR APIs)
- `ffmpeg` / whisper backends (voice transcription)
- `python3` / pillow (icons/scripts)

Fix direction:
- Detect + report in UI (Settings → Diagnostics), don’t hard-fail.

## Cross-platform test matrix (minimum)

### Native Windows (PowerShell)
- Start backend: `npm run dev:server`
- Start UI: `npm run dev:client`
- Create/open workspace
- Spawn Agent + Server terminals (PowerShell)
- Run Commander auto-start (no duplicates; commands execute)
- (If enabled) Diff viewer auto-start
- Tauri build + launch packaged app

### WSL/Linux (bash)
- Same as above, plus:
- `build-production-with-console.sh` works (or remains supported as Linux-only)

## Recommended implementation order (concrete tasks)

### P0 (unblock “native Windows works without crashing”)
- [x] Replace `process.env.HOME`-only joins with `os.homedir()` fallback in the known hotspots.
- [x] Replace `PortRegistry.isPortFree()` from `lsof` → Node bind test.
- [x] Make PTY-injected env-var commands PowerShell-safe where used (at least server-control start).

### P1 (make Windows actually pleasant)
- [x] Add “Diagnostics” panel: show missing external deps (git/gh/claude/codex/ffmpeg).
- [x] Improve `scripts/tauri/prepare-backend-resources.js` UX (auto-bundle the current Node runtime if possible).
- [x] Add a short “Windows Quick Start” doc (developer vs end-user paths), pointing to the long `WINDOWS_BUILD_GUIDE.md`.

### P2 (optional / product polish)
- [x] Windows implementation for `scanAllPorts()` (or mark WSL-only).
- [x] Evaluate prebuilt PTY dependency to reduce contributor friction.
  - Looked at `@homebridge/node-pty-prebuilt-multiarch` and `node-pty-prebuilt-multiarch`: both lag behind `node-pty@^1.x` and increase compatibility risk.
  - Decision: **keep `node-pty`** for runtime correctness. For end-users, the intended path is a packaged Tauri build that ships compiled deps (no Visual Studio required).

## Related docs
- `WINDOWS_BUILD_GUIDE.md` (detailed Windows build pain log + fixes)
- `PLANS/2026-02-02/WINDOWS_DISTRIBUTION_AND_MONETIZATION_PLAN.md` (how to ship + package + license later)
