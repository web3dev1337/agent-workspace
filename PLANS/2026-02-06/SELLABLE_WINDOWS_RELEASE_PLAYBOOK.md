# Sellable Windows release playbook (Tauri) — 2026-02-06

Goal: ship a Windows installer that “just works” for end users (no Rust/VS toolchains), while keeping the product **local-first** and safe-by-default.

This repo already supports Tauri packaging (`src-tauri/`) and CI builds (`.github/workflows/windows.yml`).

---

## 0) Definitions (who is this for?)

### End users
Want an installer. Should **not** need:
- Rust
- Visual Studio C++ build tools
- Windows SDK / Spectre libs

### Builders / maintainers
Need to produce the installer artifacts (MSI/EXE). Builders **do** need:
- Rust + MSVC toolchain
- VS build tools (because of `node-pty`)
- Windows SDK + Spectre libs

Key point:
- Build pain is acceptable for maintainers.
- End-user install must be smooth.

---

## 1) End-user path (recommended)

1) Download the installer from GitHub Releases:
   - `.msi` (enterprise-friendly)
   - NSIS `*-setup.exe`
2) Install “Claude Orchestrator” from the Start Menu.
3) On first run:
   - The app spawns the local backend and binds to loopback (`127.0.0.1`).
   - A per-launch `AUTH_TOKEN` is generated automatically (packaged builds).
4) Run `Settings → Diagnostics` if anything is missing (`git`, `gh`, `claude`, `codex`, etc.).

If you see “setup is already running”:
- wait for the existing installer instance to finish or close it in Task Manager
- then re-run the installer

If Windows says “get an app to open this link”:
- you likely clicked a non-executable artifact or a link-handling issue occurred
- prefer the `.msi` or the NSIS `*-setup.exe` from the Release assets

---

## 2) Maintainer path (build locally on Windows)

This is for testing changes before tagging.

Docs:
- `WINDOWS_QUICK_START.md` (short)
- `WINDOWS_BUILD_GUIDE.md` (long, includes build failures + fixes)

Typical build (PowerShell):
```powershell
cd claude-orchestrator-dev
npm install
npm run tauri:build
```

Artifacts:
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

---

## 3) Maintainer path (recommended): build via CI + tags

Why:
- most repeatable
- clean environment
- produces a stable “sellable” artifact

### 3.1 Tag a release

1) Ensure `main` is green.
2) Pick a version tag:
   - `v0.1.0`, `v0.1.1`, etc.
3) Create the tag and push it:
```bash
git tag v0.1.0
git push origin v0.1.0
```

### 3.2 Confirm CI artifacts

Workflow:
- `.github/workflows/windows.yml`

Expected:
- Windows unit tests run
- Tauri installer build runs (tags / workflow_dispatch only)
- GitHub Release is created (tags only) with:
  - MSI + NSIS EXE attached

### 3.3 Smoke test checklist (what to test before sharing)

- App launches without console window (release builds use `windows_subsystem`)
- UI loads reliably
- Commander terminal starts (PowerShell on Windows)
- Basic actions:
  - open Queue
  - open Review Console for a PR URL
  - open/Embed Diff viewer
  - run Diagnostics (shows `gh auth status`)
- Verify “LAN binding” is not enabled by default

---

## 4) “Ready to sell” hardening checklist (non-negotiables)

### Product safety defaults
- Bind to loopback by default (`127.0.0.1`)
- Require `AUTH_TOKEN` for any non-loopback binding
- Packaged builds always run with `AUTH_TOKEN` set (generated per launch)

### Privacy
- Do not bundle user data into installers
- Ensure `.env`, `user-settings.json`, `sessions/`, `diff-viewer/cache/`, `test-results/` are ignored and not shipped

### Security hygiene
- Avoid shell interpolation where possible (prefer `execFile/spawn` with args)
- Keep Diagnostics available to users to self-troubleshoot missing tools

References:
- `PUBLIC_RELEASE_AUDIT_2026-02-06.md`
- `SECURITY.md`

---

## 5) Monetization realities (local-first)

Local-first means:
- UI-only paywalls are bypassable if the core is open source

If monetization is real:
- enforce entitlements **server-side** (or in closed-source modules)

Good “Pro” candidates:
- automation packs (reviewer/fixer/recheck/overnight policies)
- advanced review routes + saved layouts
- team sharing / encrypted shared stores
- enterprise integrations

References:
- `PLANS/2026-02-05/PUBLISHING_AND_MONETIZATION_OPTIONS.md`
- `PLANS/2026-02-05/PLUGIN_ARCHITECTURE_AND_PRO_GATING.md`

