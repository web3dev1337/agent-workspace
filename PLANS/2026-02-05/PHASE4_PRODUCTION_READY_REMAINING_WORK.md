# Phase 4 — Production-ready + sellable (Remaining work)

Date: 2026-02-05

This is the consolidated “what’s left” list for **Phase 4**: making the orchestrator production-ready (Windows + Linux/WSL) and ready to publish/sell, *without* rewriting history yet.

Ordering: **actionable remaining work first**, “no remaining work / already shipped” at the bottom (so you don’t have to filter).

---

## 1) Remaining work (actionable)

### A) Review Console v2 — “batch review surface” UX overhaul

Goal: a single-click surface to batch review Tier 3+ items with minimal vertical waste.

- [ ] Make the Review Console a true “review route” surface:
  - filter/sort within the console (tier/risk/unreviewed/blocked/claimed)
  - “Next unreviewed T3” navigation (not just Next/Prev in the captured stack)
- [ ] Reduce vertical waste further (tighten paddings, make meta blocks collapsible by default).
- [ ] Terminal grouping polish:
  - keep Agent + Server side-by-side consistently (Agent always left when both visible)
  - ensure symmetric controls (avoid “server feels different” surprises)
- [ ] Make failures explicit when GitHub data is missing:
  - if PR details calls fail, show a clear banner + “Retry” (not “0 files” with no clue)

References:
- `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`
- `PLANS/2026-02-02/PHASE4_FULL_UI_CONTROL_REMAINING_WORK.md`

### B) Workspaces / Worktrees / Sessions lifecycle correctness (“no leftovers”)

Goal: when you close/remove something, it’s truly gone (and doesn’t pile up in recovery).

- [ ] Clarify and standardize the two destructive actions in UI copy (everywhere):
  - “Close terminal process” (kills PTY, keeps worktree in workspace)
  - “Remove worktree from workspace” (kills all group sessions, removes from workspace config, keeps files on disk)
- [ ] Eliminate confusing duplicate “✕” buttons and make the intent unambiguous.
- [ ] Add a small Help/Glossary panel (UI) explaining:
  - workspace vs worktree vs session/terminal
  - agent vs server pairing (and why they live/die together)
- [ ] Session recovery policy improvements:
  - show only actionable recoverables by default
  - optional “Archived/Closed sessions” collapsible list
  - add “Clear recoverables older than N days” (with confirmation)

### C) Public release: privacy + security hardening (without destructive history actions)

Goal: make the repo safe to publish and easy to reason about.

- [ ] Decide which docs should be public vs private companion repo (internal project names, screenshots, workflow logs).
- [ ] Replace “real project” examples in docs with placeholders where desired (`OWNER/REPO`, `~/Projects/MyGame`, etc.).
- [ ] Add baseline public-facing repo files:
  - `SECURITY.md` (reporting policy + threat model summary)
  - `CONTRIBUTING.md` (optional)

Important: do **not** rewrite history yet (separate step).

References:
- `PUBLIC_RELEASE_AUDIT_2026-02-05.md`
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

### D) Packaging / shipping (Windows-first)

Goal: end users install an `.msi` / `.exe` and run the app without dev toolchains.

- [ ] Validate the tag-based release path end-to-end:
  - Windows CI builds installer artifacts
  - release notes + attached artifacts are correct
- [ ] Decide initial release posture:
  - unsigned internal builds vs code-signed public builds
  - portable zip vs installer
- [ ] Consider adding an auto-updater (optional; can be Phase 4.1)

References:
- `WINDOWS_QUICK_START.md`
- `WINDOWS_BUILD_GUIDE.md`
- `PLANS/2026-02-02/WINDOWS_DISTRIBUTION_AND_MONETIZATION_PLAN.md`
- `.github/workflows/windows.yml`

### E) Premium / plugin modularity (if monetization is a real goal)

Goal: enable “Free vs Pro” without turning core into spaghetti.

- [ ] Decide “Pro v1” feature list (server-enforced; UI gating is UX-only).
- [ ] Implement a minimal plugin loader (server-side first):
  - load `plugins/<id>/server.js` at startup
  - allow plugin routes under `/api/plugins/<id>/*`
  - (optional) allow plugins to register commands into `CommandRegistry`
- [ ] Decide whether client plugin support is in-scope for Phase 4 or Phase 5 (it’s higher risk because `client/app.js` is large and not modular).

References:
- `PLANS/2026-02-05/PUBLISHING_AND_MONETIZATION_OPTIONS.md`
- `PLANS/2026-02-05/PLUGIN_ARCHITECTURE_AND_PRO_GATING.md`

### F) Scheduler / “cron jobs” for orchestrations

Goal: safe, auditable automations (disabled by default).

- [ ] Design + implement a small “Scheduler” service:
  - schedules stored locally (user settings)
  - each schedule runs a semantic command (CommandRegistry) with a safety policy
  - audit log of what ran + when
- [ ] Add a UI surface (minimal) to enable/disable and view schedules.

---

## 2) Shipped / no remaining work (for this slice)

### A) Windows support baseline (native Windows + WSL)
- ✅ Windows build pain + fixes documented (`WINDOWS_BUILD_GUIDE.md`).
- ✅ Windows CI runs unit tests on PRs and pushes; Tauri build remains tag/dispatch-gated (`.github/workflows/windows.yml`).

### B) Review Console defaults + reliability improvements
- ✅ Review Console defaults to the diff-dominant `review` preset (`client/app.js`).
- ✅ Review Console can show GitHub PR details (files/commits/comments) and embeds the Advanced Diff Viewer.
- ✅ Diff “Embed” default is controlled via Settings → Review Console; per-console “Close” no longer disables the default.

### C) Skins / “Blue mode”
- ✅ Skin system exists (Light/Dark + Default/Blue/Purple/Emerald/Amber) with intensity control.
  - Primary blue is `#0f67fd` (`client/styles.css`).

### D) Security/privacy audit (plan-only for destructive cleanup)
- ✅ History scanned with `gitleaks` (no secrets found).
- ✅ Clear plan exists for removing historical artifacts + rewriting author emails (not executed yet).

References:
- `PUBLIC_RELEASE_AUDIT_2026-02-05.md`
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

