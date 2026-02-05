# Phase 4 — Production-ready + sellable (Remaining work)

Date: 2026-02-06

This is the consolidated “what’s left” list for **Phase 4**: making the orchestrator production-ready (Windows + Linux/WSL) and ready to publish/sell, *without* rewriting history yet.

Ordering: **actionable remaining work first**, “no remaining work / already shipped” at the bottom (so you don’t have to filter).

---

## 1) Remaining work (actionable)

### A) Review Console v2 — “batch review surface” UX overhaul

Goal: a single-click surface to batch review Tier 3+ items with minimal vertical waste.

- [x] Make the Review Console a true “review route” surface:
  - [x] filter/sort within the console route stack (tier/risk/unreviewed/blocked/claimed)
  - [x] add a single “Review route” launcher (Queue → open console already filtered + stacked)
- [x] Reduce vertical waste further (tighten paddings, make meta blocks collapsible by default).
- [x] Layout v2:
  - [x] keep Agent + Server side-by-side consistently (Agent always left when both visible)
  - [x] make Diff embed the dominant pane by default (single-screen, minimal vertical scrolling)

References:
- `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`
- `PLANS/2026-02-02/PHASE4_FULL_UI_CONTROL_REMAINING_WORK.md`

### B) Workspaces / Worktrees / Sessions lifecycle correctness (“no leftovers”)

Goal: when you close/remove something, it’s truly gone (and doesn’t pile up in recovery).

- [x] Clarify and standardize the two destructive actions in UI copy (everywhere):
  - “Close terminal process” (kills PTY, keeps worktree in workspace)
  - “Remove worktree from workspace” (kills all group sessions, removes from workspace config, keeps files on disk)
- [x] Eliminate confusing duplicate “✕” buttons and make the intent unambiguous.
- [x] Add a small Help/Glossary panel (UI) explaining:
  - workspace vs worktree vs session/terminal
  - agent vs server pairing (and why they live/die together)

### C) Public release: privacy + security hardening (without destructive history actions)

Goal: make the repo safe to publish and easy to reason about.

- [x] Decide which docs should be public vs private companion repo (internal project names, screenshots, workflow logs).
- [x] Replace “real project” examples in docs with placeholders where desired (`OWNER/REPO`, `~/Projects/MyGame`, etc.).
- [x] Add baseline public-facing repo files:
  - `CONTRIBUTING.md` (optional)

Important: do **not** rewrite history yet (separate step).

References:
- `PUBLIC_RELEASE_AUDIT_2026-02-05.md`
- `PUBLIC_RELEASE_AUDIT_2026-02-06.md`
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`
- `PLANS/2026-02-06/PHASE4_DECISIONS_2026-02-06.md`

### D) Packaging / shipping (Windows-first)

Goal: end users install an `.msi` / `.exe` and run the app without dev toolchains.

- [ ] Validate the tag-based release path end-to-end:
  - Windows CI builds installer artifacts
  - release notes + attached artifacts are correct
- [x] Decide initial release posture:
  - unsigned internal builds vs code-signed public builds
  - portable zip vs installer
- [x] Consider adding an auto-updater (optional; can be Phase 4.1)

References:
- `WINDOWS_QUICK_START.md`
- `WINDOWS_BUILD_GUIDE.md`
- `PLANS/2026-02-02/WINDOWS_DISTRIBUTION_AND_MONETIZATION_PLAN.md`
- `.github/workflows/windows.yml`

### E) Premium / plugin modularity (if monetization is a real goal)

Goal: enable “Free vs Pro” without turning core into spaghetti.

- [x] Decide “Pro v1” feature list (server-enforced; UI gating is UX-only).
- [x] Implement a minimal plugin loader (server-side first):
  - [x] load `plugins/<id>/server.js` at startup
  - [x] allow plugin routes under `/api/plugins/<id>/*`
  - [x] allow plugins to register commands into `CommandRegistry` via a namespaced helper
- [x] Decide whether client plugin support is in-scope for Phase 4 or Phase 5 (it’s higher risk because `client/app.js` is large and not modular).

References:
- `PLANS/2026-02-05/PUBLISHING_AND_MONETIZATION_OPTIONS.md`
- `PLANS/2026-02-05/PLUGIN_ARCHITECTURE_AND_PRO_GATING.md`
- `PLANS/2026-02-06/PHASE4_DECISIONS_2026-02-06.md`

### F) Scheduler / “cron jobs” for orchestrations

Goal: safe, auditable automations (disabled by default).

- [x] Design + implement a small “Scheduler” service:
  - [x] schedules stored locally (user settings)
  - [x] each schedule runs a semantic command (CommandRegistry) with a safety policy
  - [x] audit log of what ran + when
- [x] Add a UI surface (minimal) to enable/disable and view schedules.

---

## 2) Shipped / no remaining work (for this slice)

### A) Windows support baseline (native Windows + WSL)
- ✅ Windows build pain + fixes documented (`WINDOWS_BUILD_GUIDE.md`).
- ✅ Windows CI runs unit tests on PRs and pushes; Tauri build remains tag/dispatch-gated (`.github/workflows/windows.yml`).
- ✅ Windows UX: hide `gh` console windows + improve `gh` auth diagnostics (PR tooling) (`server/pullRequestService.js`, `server/diagnosticsService.js`).

### B) Review Console defaults + reliability improvements
- ✅ Review Console defaults to the diff-dominant `review` preset (`client/app.js`).
- ✅ Review Console can show GitHub PR details (files/commits/comments) and embeds the Advanced Diff Viewer.
- ✅ Diff “Embed” default is controlled via Settings → Review Console; per-console “Close” no longer disables the default.
- ✅ Review Console improvements:
  - Agent/Server pairing inferred when possible and ordered Agent-left-of-Server.
  - Server/Agent visibility toggles added (Settings + in-console).
  - Clear “missing GitHub data” banners with Retry + Diagnostics shortcuts.
  - “Next unreviewed T3+” navigation works even without a captured stack.
  - Auto-retry once when PR details return empty (reduces “0 files/0 commits” confusion).
  - Files/Commits/Conversation meta blocks are collapsible (default collapsed) to reduce vertical waste.

### C) Session recovery policy
- ✅ Session recovery filters out non-actionable entries by default and supports clearing saved/old recoverables.

### D) Lifecycle UI clarity (close vs remove)
- ✅ Terminal controls are now unambiguous:
  - **×** closes terminals (kills agent+server processes; keeps worktree in workspace)
  - **🗑** removes worktree from workspace (kills terminals; keeps files)
- ✅ Settings now includes a **Glossary** section explaining workspaces/worktrees/sessions and agent/server pairing.

### E) Skins / “Blue mode”
- ✅ Skin system exists (Light/Dark + Default/Blue/Purple/Emerald/Amber) with intensity control.
  - Primary blue is `#0f67fd` (`client/styles.css`).

### F) Security/privacy audit (plan-only for destructive cleanup)
- ✅ History scanned with `gitleaks` (no secrets found).
- ✅ Clear plan exists for removing historical artifacts + rewriting author emails (not executed yet).
- ✅ Baseline `SECURITY.md` added.

References:
- `PUBLIC_RELEASE_AUDIT_2026-02-05.md`
- `PUBLIC_RELEASE_AUDIT_2026-02-06.md`
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`
