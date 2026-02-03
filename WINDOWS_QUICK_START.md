# Windows Quick Start (Native Windows + optional WSL)

Date: 2026-02-03

This repo supports two Windows paths:

1) **End user (recommended): install the packaged desktop app**
2) **Developer: run from source / build an installer**

If you want the existing bash-first workflows (and `.sh` helper scripts), use **WSL**.

---

## 1) End users (recommended): install the desktop app

You should **not** need Visual Studio, Rust, or Node just to *use* the app.

Deliverable is a Tauri installer:
- `.msi` (enterprise-friendly)
- NSIS `.exe` installer

Once installed, launch “Claude Orchestrator” from Start Menu.

---

## 2) Developers: run the web app from source (fastest)

Prereqs:
- Node.js (LTS recommended)
- Git for Windows
- (Recommended) PowerShell 7+ or Windows PowerShell

Commands (PowerShell):
```powershell
cd claude-orchestrator-dev
npm install
npm run dev
```

Open:
- `http://localhost:2080`

Notes:
- Some features require external tools (GitHub CLI `gh`, `claude`, `codex`, `ffmpeg`, etc.). See **Settings → Diagnostics**.

---

## 3) Developers: build a Windows installer (Tauri)

Prereqs:
- Rust (MSVC toolchain)
- Visual Studio 2022 “Desktop development with C++”
- Windows SDK + Spectre-mitigated libraries (required by `node-pty` native builds)
- Node.js + npm

Build (PowerShell):
```powershell
cd claude-orchestrator-dev
npm install
npm run tauri:build
```

Notes:
- `npm run tauri:build` runs `scripts/tauri/prepare-backend-resources.js --install-prod` and by default bundles the current Node runtime into the app resources.
- To skip bundling Node, set:
  - `ORCHESTRATOR_SKIP_BUNDLE_NODE=1`

Artifacts:
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

CI option (recommended for repeatable release builds):
- Run the GitHub Actions workflow `windows` (workflow_dispatch) or push a tag like `v1.2.3`.
- It runs Windows unit tests and produces installer artifacts via `npm run tauri:build`.

---

## 4) Optional: WSL mode (bash-first workflows)

If you rely on repo scripts like `build-production-with-console.sh`, run the orchestrator from WSL/Linux.

In WSL:
```bash
npm install
npm run dev
```
