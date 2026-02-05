# Publishing + monetization options (Windows-first)

Date: 2026-02-05

This doc answers:
1) “How do we publish this on GitHub without leaking data?”
2) “Free vs premium — what’s possible for a local-first tool like this?”

Scope: `claude-orchestrator-dev` (orchestrator + diff-viewer + Tauri wrapper).

---

## What “publish on GitHub” usually means

- **Public repository**: the full code + history is visible.
- **Releases**: you upload **prebuilt installers/binaries** (e.g. Windows `.msi` / `.exe`), so users don’t compile from source.
- **License**: a `LICENSE` file defines what others can do with the code.

For a “ready to sell” Windows-first product, the most important thing is **shipping a prebuilt installer** so users don’t need Visual Studio toolchains, Rust, etc.

---

## Free vs premium — models that actually work

### Model A: Fully open source (free core)

- Publish repo under permissive license (MIT/Apache-2.0) or copyleft (GPL/AGPL).
- Monetize via:
  - paid support / onboarding
  - consulting / custom automations
  - sponsorships

Best when you want maximum adoption, but it’s harder to tie revenue to usage.

### Model B: Open-core (recommended here)

- **Core** (local orchestrator) is public/open.
- **Pro modules** are closed-source and distributed separately (download after purchase).
- Monetize via subscriptions or one-time licenses (Pro/Team/Enterprise).

Why this fits this project:
- The core value is local-first orchestration using “primitive” Claude Code / Codex flows.
- The “pay for convenience” features are very real (automation, dashboards, team workflows).

Important reality: if the client is open-source and local, **client-only gating is bypassable**. Pro features must be enforced **server-side** (or in a closed-source module).

### Model C: Source-available (not OSS)

- Publish code but restrict commercial use (e.g. BSL-style, “non-commercial”).
- You sell commercial licenses.

This is simpler than plugins, but many developers dislike it and it reduces community contributions.

### Model D: Paid binaries (keep source private)

- You ship an installer only.
- Highest control, but lowest trust/visibility and harder to get contributions.

### Model E: Hybrid local app + optional SaaS

- Core stays local; paid add-on is a hosted service:
  - sync across machines
  - team dashboards
  - shared task/PR state across devices

This can be lucrative, but it adds an entire security/compliance surface and you lose some of the “pure local-first” beauty.

---

## What we can sell (without betraying “local-first”)

Good “premium” candidates that feel fair:
- **Automation packs**: Auto Reviewer / Auto Fixer / Auto Recheck / Overnight rules, with richer policy + guardrails.
- **Advanced review UX**: richer diff embed, multi-PR batch review flows, saved layouts, “review routes”.
- **Team workflow**: shared workspace templates, shared prompt artifacts, shared encrypted records.
- **Integrations**: enterprise GitHub org features, Jira/Linear, Slack/Discord advanced features.
- **Installers + auto-update**: a polished Windows installer, plus “it just works” updates.

Avoid paywalling basics (or people will fork immediately):
- viewing terminals, starting worktrees, basic queue browsing, manual review actions.

---

## How to do premium gating safely (in this codebase)

### Today’s state (already present)

There’s already a licensing surface:
- `server/licenseService.js`
- `server/licenseMiddleware.js`

That’s enough to enforce **server-side** entitlements (Free vs Pro) on:
- HTTP endpoints (`/api/...`)
- command actions (Commander/voice)

### Recommended enforcement rules

- **Server is the source of truth** for entitlements.
- UI can *hide* Pro-only buttons, but server must **reject** Pro-only operations when unlicensed.
- Keep a “Free fallback” for anything that could otherwise break existing user workflows.

---

## Windows-first packaging (sellable) options

### Option 1: Tauri desktop app (recommended)

Pros:
- Produces a real Windows installer.
- Bundles a backend process (Node) + frontend UI.
- You can include an `AUTH_TOKEN` handshake and bind to loopback by default.

Cons:
- Building from source requires Rust toolchain.
- Native Node deps (e.g. PTY) are painful for *builders*, but end users can use your prebuilt installer.

### Option 2: “Portable zip” distribution

- Ship `node.exe` + `node_modules` + `start.cmd` in a zip.
- Quick and simple.
- Still a “developer-ish” install.

### Option 3: Native Windows service + local web UI

- Much more complex, but possible.
- Not necessary for v1.

---

## Publishing plan (safe-by-default)

### 1) Decide the public posture

Pick one:
- **Open-core** (public core + private Pro modules), or
- **Fully OSS**, or
- **Private source + paid binaries**

### 2) Remove history leaks before going public

If you want *public history*, do a one-time history rewrite:
- See `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

If you don’t care about keeping history:
- Create a **new public repo** with a **single squashed commit** (clean tree).

### 3) Add baseline public-repo files

- `LICENSE` (choose license)
- `README.md` (clear install + threat model)
- `SECURITY.md` (how to report vulns)
- `CONTRIBUTING.md` (optional)

### 4) Ship installers via GitHub Releases

- Add CI builds that produce:
  - Windows installer (Tauri)
  - Windows portable zip (optional)
  - Linux build artifacts (optional)

### 5) Make “LAN usage” explicit

If you support mobile/LAN access:
- require `AUTH_TOKEN`
- document it as a deliberate opt-in

---

## Recommendation (if you want a business fast)

1) Keep the repo public under permissive license (MIT/Apache-2.0) **for core**.
2) Ship a polished Windows installer (Tauri) as the primary “product”.
3) Sell **Pro** as:
   - a private plugin pack (download after purchase), or
   - a separate closed-source “Pro build” that bundles Pro modules.
4) Enforce Pro on the server (licenses signed; no cloud required).

If you want, next step is to write a concrete “Open-core Pro modules” technical design that specifies:
- plugin loading mechanism
- entitlements
- what Pro actually contains v1
- release pipeline (Windows) + update strategy

