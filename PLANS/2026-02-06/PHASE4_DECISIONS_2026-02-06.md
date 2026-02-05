# Phase 4 decision log (2026-02-06)

This file records explicit decisions for the remaining Phase 4 checklist items.

---

## 1) Public docs vs private docs

Decision:
- Keep a **public docs set** in this repo:
  - `README.md`
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `WINDOWS_QUICK_START.md`
  - `PLANS/2026-02-06/SELLABLE_WINDOWS_RELEASE_PLAYBOOK.md`
- Keep **internal-only docs** private (or in a private companion repo):
  - `PUBLIC_RELEASE_AUDIT_*.md`
  - `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`
  - any plan/log docs that include internal project names, local machine paths, or customer workflow traces.

Rationale:
- Public users get install and security guidance.
- Internal operations and privacy-sensitive audit traces stay out of the public surface.

---

## 2) Placeholder policy for public-facing examples

Decision:
- For public docs, use placeholders in examples:
  - `OWNER/REPO`
  - `~/Projects/MyProject`
  - `pr:OWNER/REPO#123`
  - `trello:SHORTLINK`
- Keep concrete internal examples only in private docs.

Rationale:
- Prevent unnecessary project fingerprinting while still giving usable examples.

---

## 3) Windows release posture (initial)

Decision:
- Primary install path: **Windows MSI + NSIS setup EXE** from GitHub Releases.
- Initial release posture: **unsigned internal/public beta builds** first, then code-signing after distribution path is stable.
- Keep portable zip as optional fallback, not the primary path.

Rationale:
- Lowest friction for end users.
- Avoid code-signing complexity until packaging and support loop are stable.

---

## 4) Auto-updater scope

Decision:
- Auto-updater is **Phase 4.1**, not Phase 4.

Rationale:
- Not required to ship/sell v1.
- Adds update-channel and signing complexity that should come after installer reliability is stable.

---

## 5) Pro v1 feature boundary

Decision:
- Free/core:
  - workspace/worktree/session management
  - basic queue/review/manual PR actions
  - baseline diagnostics
- Pro v1:
  - advanced automation policies (reviewer/fixer/recheck/overnight guardrails)
  - advanced review-route presets/profiles and saved workflows
  - team/shared workflow capabilities (shared stores, policy packs)
  - premium integrations and enterprise controls

Enforcement:
- Server-side entitlements only (UI gating is UX-only).

---

## 6) Plugin scope (Phase 4 vs Phase 5)

Decision:
- Phase 4: server-side plugin loader only (implemented).
- Phase 5: client plugin surface after UI modularization (panel/registry split from `client/app.js`).

Rationale:
- Server plugin loading is low-risk and already enabled.
- Client plugin API on current monolithic UI would create high maintenance risk.

