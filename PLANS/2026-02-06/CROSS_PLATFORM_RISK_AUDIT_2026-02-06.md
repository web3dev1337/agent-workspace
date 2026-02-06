# Cross-platform risk audit (Windows / WSL / Linux) — 2026-02-06

Goal: identify where `claude-orchestrator-dev` can break across:
- **Windows (native)**: `process.platform === 'win32'`
- **Windows + WSL**: orchestrator running in WSL, UI used from Windows
- **Linux (native)**

This is a pragmatic “what can go wrong + what we should do about it” doc. It’s not a redesign spec.

---

## Quick takeaways

1) The biggest risk is **native deps + PTY** on Windows (build-time pain), not JS logic.
2) Runtime issues cluster around:
   - **shell selection + quoting**
   - **path conversion (WSL ↔ Windows)**
   - **process execution flags** (e.g., `windowsHide`)
   - **tools availability** (`git`, `gh`, `bash`)
3) Security-wise, cross-platform hardening often aligns with safer code:
   - prefer `execFile/spawn` with args arrays (avoid shell)
   - avoid interpolating strings into shell commands

---

## Platform matrix (what we rely on)

### Core runtime
- Node.js (backend)
- Browser UI (web)
- Optional desktop wrapper: **Tauri** (`src-tauri/`)

### Key external tools
- `git` (repo detection / status / worktrees)
- `gh` (PR details, merge/review actions)
- Shell:
  - Windows native: `powershell.exe` (preferred)
  - Linux/WSL: `bash` (preferred)

### Native deps
- `node-pty` (terminal PTY)
  - Windows builds often require Visual Studio Build Tools + Windows SDK + Spectre libs.
  - See `WINDOWS_BUILD_GUIDE.md`.

---

## Known cross-platform hotspots (repo-specific)

### 1) Shell selection / quoting

Where:
- `server/sessionManager.js` chooses `powershell.exe` vs `bash`
- `server/commanderService.js` chooses `powershell.exe` vs `bash`
- `server/utils/shellCommand.js` contains quoting helpers and a “build shell command” helper.

Risks:
- Shell-specific quoting bugs (especially paths containing quotes/spaces).
- Assumptions that `bash` is present even when running on Windows native.

Mitigation:
- Keep *all* “compose a command string” logic in `server/utils/shellCommand.js`.
- Prefer `execFile/spawn` with args arrays whenever possible.

### 2) Windows process window flashing

Where:
- Any `execFile/spawn` that launches `gh`, `git`, `node`, etc.

Mitigation:
- Add `{ windowsHide: true }` consistently (already done for `gh` PR tooling and `gitHelper.execFileSafe`).

Status:
- ✅ `server/pullRequestService.js` now uses `windowsHide: true` for all `gh` invocations.

### 3) WSL ↔ Windows path conversion (Explorer, browser opens)

Where:
- `server/index.js` has a `reveal-in-explorer` handler that uses `wslpath` + `explorer.exe`.
- `src-tauri/src/main.rs` attempts WSL-aware URL opening (prefers `wslview`, falls back to `powershell.exe`).

Risks:
- Incorrect quoting when paths contain `'` or special chars.
- Features that only work in WSL but are invoked on Linux native.

Mitigation:
- Treat these as **WSL-only** helpers and guard explicitly with WSL detection.
- Avoid shell interpolation where possible.

### 4) Build/automation scripts assume bash

Where:
- Orchestrator production build script uses bash (see `server/index.js` build path).
- Diff viewer ships many `*.sh` scripts.

Risks:
- Running these from Windows native fails unless git-bash/MSYS is installed.

Mitigation:
- For “sellable” distribution: end users should not run build scripts at all (use installer artifacts).
- For dev experience: add PowerShell equivalents only where they’re actually needed.

### 5) Hard-coded command names on Windows

Where:
- `npm` vs `npm.cmd` handled in several places:
  - `server/diffViewerService.js`
  - `server/testOrchestrationService.js`

Risk:
- One missed spot breaks Windows native.

Mitigation:
- Centralize via a small helper (e.g. `getNpmCommand()` / `getNodeCommand()`).

### 6) “Linux-only” process helpers

Where:
- `server/sessionManager.js` contains `pgrep` usage for process checks.

Risk:
- Fails on Windows native unless guarded.

Mitigation:
- Keep Windows branches explicit; avoid executing Linux commands on win32.

---

## What to test on each platform (practical checklist)

### Windows native (Node runs on Windows)
- Install + run orchestrator (`npm start`)
- Start Commander (PTY) and verify:
  - PowerShell starts
  - input newlines work (`\r\n`)
  - “start Claude” doesn’t double-spawn
- PR tooling:
  - `gh auth status` shows in Diagnostics
  - PR details fetch shows files/commits
  - merge/review actions work
- Diff viewer:
  - starts and embeds in Review Console
  - doesn’t pop extra console windows when calling child processes

### WSL (Node runs in WSL, browser on Windows)
- Startup scripts (if used)
- Reveal in explorer opens **Windows** Explorer
- Diff viewer open/embed works

### Linux native
- “basic everything” works without WSL-specific assumptions
- Confirm `reveal-in-explorer` does something reasonable (or is hidden/disabled)

---

## Actionable hardening tasks (status)

- [x] Remove remaining shell interpolation risk in process-limit checks:
  - `server/sessionManager.js` now uses `execFile('pgrep', ['-P', pid])` instead of shell `exec(...)`.
- [x] Harden branch/update safety:
  - `server/gitUpdateService.js` now rejects detached/sentinel/invalid branch names before pull/update checks.
- [x] Harden `reveal-in-explorer` path handling:
  - `server/index.js` now resolves/stats/exists-checks target paths before launching explorer/file manager.
- [x] Add a “platform smoke” diagnostics section:
  - `server/diagnosticsService.js` now returns `platformSmoke` checks for shell/git/gh/gh-auth.
  - `client/app.js` diagnostics panel now renders these checks.
- [x] Improve child-process spawn consistency:
  - `server/diffViewerService.js` and `server/testOrchestrationService.js` now pass `windowsHide: true`.
  - `server/diffViewerService.js` validates `cwd` before spawning child processes.

References:
- `WINDOWS_BUILD_GUIDE.md`
- `WINDOWS_QUICK_START.md`
