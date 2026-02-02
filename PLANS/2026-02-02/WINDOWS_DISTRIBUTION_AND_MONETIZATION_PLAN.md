# Windows Distribution + Monetization Plan (Local‑First)

Date: 2026-02-02

This plan is based on the current repo state in `claude-orchestrator-dev`:
- **Backend**: Node/Express + Socket.IO (`server/index.js`)
- **PTY sessions**: `node-pty` via `server/sessionManager.js` (spawns real terminals; “primitive” by design)
- **UI**: static HTML/JS served by backend (`client/index.html`, `client/app.js`, etc.)
- **Native shell already present**: a **Tauri v2 app** (`src-tauri/`) currently used mainly as a window wrapper + external-link handling (`client/tauri-compat.js`).

Goal: ship a Windows‑first product that stays **local**, preserves “real terminals” (Claude Code/Codex as-is), and avoids leaking user data.

---

## 1) Current how-it-works (under the hood)

### Runtime topology (today)
- User runs `npm run dev`:
  - `server/index.js` starts the backend (default port `3000` unless overridden)
  - `client/dev-server.js` starts the dev UI server (default port `2080`) proxying `/api` to backend
- In prod-ish mode, the backend serves `client/` directly (see `server/index.js` route `/` and `express.static`).
- Terminals are **real PTYs** managed server-side, streamed to the browser via Socket.IO.

### Security posture (today)
- Backend has **optional** auth token middleware:
  - `AUTH_TOKEN` env var enables `X-Auth-Token` header requirement and socket auth (`server/index.js`).
- CORS allows `tauri://localhost` and `http://localhost:*` origins.
- No “product licensing” concept; everything is just local scripts.

---

## 2) Windows distribution options (practical)

### Option A (recommended): Ship the existing Tauri app as the Desktop shell, and have it start/own the Node backend

Why this matches the product:
- Keeps everything local.
- Keeps “primitive terminals”: we continue to use the Node backend + `node-pty`.
- Provides a real Windows app experience (Start menu, single icon).
- Small surface area change vs rewriting the backend in Rust.

What needs to change (because today Tauri does not start the backend):
- Tauri **must spawn** the Node server process on app startup.
- The UI window must point at the spawned server’s `http://127.0.0.1:<port>/`.

### Option B: Electron shell that starts the Node backend

Pros:
- Very common for Node+PTY apps on Windows; simplest mental model.
Cons:
- Larger bundle size.
- You already have `src-tauri/` integrated; switching shells adds work and risk.

### Option C: “Zip/portable” distribution (CLI installer)

Pros:
- Fastest to ship to power users.
Cons:
- Weak UX (ports, startup scripts, firewall prompts) and licensing story is harder.

Recommendation: **Option A (Tauri)**.

---

## 3) Tauri (Windows) packaging plan (exact)

### 3.1 Build shape (what gets bundled)
Bundle contents:
- Tauri app (Rust) + WebView2 webview
- **Node runtime** (Windows `node.exe`) as an app resource
- App JS assets:
  - `server/` JS backend
  - `client/` static UI (or keep serving via backend)
- Any required helper binaries/scripts (optional)

Important: **do not rely on WSL** for the shipped Windows app. It must run natively.

### 3.2 Startup flow (target)
On app launch:
1. Tauri generates:
   - a random free local port (or fixed `3000` if safe)
   - a random `AUTH_TOKEN` (required, not optional in packaged builds)
2. Tauri spawns the backend:
   - `node.exe server/index.js`
   - env:
     - `ORCHESTRATOR_PORT=<chosen>`
     - `ORCHESTRATOR_HOST=127.0.0.1` (add support if not present yet; see §4)
     - `AUTH_TOKEN=<random>`
3. Tauri opens the webview at `http://127.0.0.1:<port>/`
4. On app exit:
   - Tauri terminates the backend process (best-effort, graceful first, then kill).

### 3.3 Required repo changes (implementation tasks)
Tauri side:
- `src-tauri/src/main.rs`
  - Implement “spawn backend process” using `tauri-plugin-shell`
  - Track child process handle; kill on exit
  - Pick a free port safely
  - Generate/store `AUTH_TOKEN` (see below)

Backend side:
- Ensure the backend can bind to **127.0.0.1** explicitly (not just defaults):
  - Add `ORCHESTRATOR_HOST` env support and pass it into `httpServer.listen(port, host)`.
- Ensure the UI can authenticate when `AUTH_TOKEN` is always on:
  - Inject token into UI responses or configure the browser to send headers.

UI side:
- When in Tauri, set the `X-Auth-Token` header on:
  - fetch calls (`/api/*`)
  - Socket.IO connection handshake (`auth.token`)

Token storage:
- For packaged builds, token can be generated per-run (ephemeral) since UI is embedded.
- For “remember me” (optional), store it in:
  - Tauri store plugin or local encrypted file (not required for v1).

---

## 4) “No data leaking” defaults (Windows product)

The product stays local, but localhost is still a real attack surface.

Required defaults:
- Backend binds to `127.0.0.1` only by default (no LAN).
- `AUTH_TOKEN` always enabled in packaged builds:
  - All `/api/*` calls must send `X-Auth-Token`.
  - Socket.IO must send token at handshake.
- Tighten CORS:
  - Allow `tauri://localhost`
  - Allow `http://127.0.0.1:<port>` only (avoid wildcard localhost if possible).

Optional hardening:
- Add a “disable dangerous endpoints” safe mode (e.g. disallow kill/restart unless UI is foreground).
- Add “confirm destructive actions” policy gate in backend for non-UI clients.

---

## 5) Monetization plan that preserves local-first “primitive terminals”

### 5.1 What you can sell (without SaaS)
Sell **software + updates + support**, not user data.

Simple packaging:
- **Free**: core orchestration (workspaces, terminals, basic queue)
- **Pro** (paid):
  - premium review workflow features
  - advanced automations (reviewer/fixer/recheck scheduling)
  - longer telemetry retention/export
  - “team workflow” features even in local mode
  - premium skins/themes pack (if you want)
- **Teams/Enterprise** (paid):
  - SSO/RBAC (still local/self-host)
  - policy controls
  - audit log export
  - priority support / SLAs

### 5.2 Licensing (works offline)
Goal: you can charge without sending project data anywhere.

Recommended approach:
- License = a signed JSON blob (`license.json`) containing:
  - customer id
  - plan (free/pro/team)
  - expiry (optional)
  - features flags
- App verifies signature offline using embedded public key.

Where to enforce:
- Server enforces feature flags for API routes / UI actions.
- UI reads `/api/license/status` to show “Pro” state.

---

## 6) Release engineering (Windows)

### 6.1 Build environment
Build on Windows (not WSL):
- Rust toolchain (MSVC)
- Node.js (Windows)
- WebView2 runtime (usually present on Win 11; installer fallback if missing)

### 6.2 Artifacts to produce
From `tauri build`:
- `*.msi` or `*.exe` installer
- optional portable zip build for power users

### 6.3 Code signing (later, but recommended)
Not required to run, but avoids SmartScreen “Unknown publisher” friction.
- Start unsigned for internal use
- Add signing once you validate demand and have revenue/cert

---

## 7) Implementation checklist (phased)

### Phase A — Make Tauri app actually usable on Windows (no licensing yet)
- [ ] Add `ORCHESTRATOR_HOST` support in backend and bind to `127.0.0.1`
- [ ] Add “packaged build requires auth token” behavior
- [ ] Update UI fetch + Socket.IO to send `X-Auth-Token` / handshake token in Tauri mode
- [ ] Update Tauri main.rs to spawn Node backend and open the URL
- [ ] Add a “backend health” screen if server fails to start (port in use, missing node.exe)
- [ ] Document Windows build commands + prerequisites

### Phase B — Productize
- [ ] Add local license file + offline verification
- [ ] Gate Pro features behind license flags
- [ ] Add auto-updater (optional)

### Phase C — Team/Enterprise add-ons (still local)
- [ ] RBAC/policy layer
- [ ] audit log export + redaction tools

---

## 8) Open questions (need your preference)

1) Do we want a **fixed port** (e.g. 3000) or a **random free port** per launch?
2) Should `AUTH_TOKEN` be ephemeral-per-launch (simpler) or stable across runs?
3) Which monetization style do you want:
   - one-time license + paid upgrades, or subscription?
4) Do you want to keep `src-tauri/src/terminal.rs` PTY implementation (Rust) for future, or remove it to reduce confusion?

