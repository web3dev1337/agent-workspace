# Phase 4 — Full UI Control (Remaining Work)

Date: 2026-02-02

Goal: Commander (typed) + Voice (exact + LLM fallback) should be able to drive **everything you can do in the UI**, using a single shared, auto-updating command registry.

This doc is the “what’s left” list after the last ~10 days of changes. Some items are bugs; some are UX/polish; some are larger feature slices.

---

## Shipped since this doc

- PR #574: Commander supports “typed” text → command execution via the same Voice parser pipeline (`POST /api/commander/execute-text`), and the Commander panel has a `/` command mode.
- PR #587: Review Console docks hidden terminals reliably; Diff embed defaults on; session recovery clearing fixed.
- PR #588: Worktree Inspector 🗂 button resolves worktreePath from workspace config (mixed-repo) and falls back to PR console with a clear toast.
- PR #589: PR Review Console Files list supports click-to-open the embedded diff viewer for that file (via `?file=...`), and “-0” is never shown for deletions.
- PR #592: PR Review Console supports Prev/Next navigation by capturing the current filtered Queue PR list (review stack).
- PR #593: Branch labels: adds manual refresh (sidebar + terminal headers) and hides non-git sentinels (`no-git`/`missing`/`invalid-path`).
- PR #594: PR details (files/commits) now load reliably for private repos via `gh pr view` + GraphQL files (instead of REST endpoints that can 404).
- PR #595: Review Console layout tweak: wider terminals column + adaptive terminal grid (avoids “micro” terminals).
- PR #597: Session recovery prompts now only count “actionable” sessions (those with `lastAgent` or `lastServerCommand`), reducing stale/noise recoverables after restarts.
- PR #599: Queue: adds Conveyor T3 + Auto Console now opens Review Console for PR items too (and adds voice/commander command `queue-conveyor-t3`).
- PR #600: Terminal close semantics: “stop-session” / Close Terminal closes the whole worktree terminal group (agent+server+codex) and clears recovery for the whole group.

## 0) Definitions / mental model gaps (needs UI+docs)

- **Workspace** = a UI container + config (which repos/worktrees exist, which terminals/pairs exist, settings).
- **Worktree** = a git worktree folder on disk (work1/work2/...).
- **Sessions / terminals** = running PTY processes (agent/server/codex/etc), associated with a worktree (or not), and associated with a workspace tab.
- **“Server” vs “Agent”** = paired sessions for a worktree, but should behave as a single unit for lifecycle (close/remove/recover), unless explicitly “advanced mode”.

Work needed:
- Add a short “What is a workspace/worktree/session?” explainer accessible from UI (e.g., Settings → Help).
- Standardize button labels: “Close terminal process” vs “Remove worktree from workspace”.

---

## 1) Commander + Voice: single source of truth command registry

Target behavior:
- **Voice**: exact-matching commands + “LLM interpretation” should both use the same command definitions.
- **Commander (typed)**: should be able to execute those same commands from a text prompt (no manual hardcoding).
- Adding a new command should automatically:
  - appear in Settings/Help (command list),
  - be available to voice’s LLM fallback prompt,
  - be available to Commander typed execution.

Work needed:
- Build an exported “command manifest” from `server/commandRegistry.js` (name, params schema, examples, safety notes). (DONE: explicit `safetyNotes` now included in catalog/capabilities and Settings has a live Command Catalog help view)
- Update voice LLM fallback prompt to include the manifest (or a scoped subset + retrieval). (DONE)
- Add `POST /api/commander/execute-text`: (DONE: PR #574)
  - input: free text
  - pipeline: same as voice parse → command execution (with a “typed” source)
  - output: structured result + a human readable summary
- Add a “Commander command mode” UX: (DONE: PR #574)
  - e.g. prefix `/` or `:` lines as commands, otherwise send as terminal text
  - show command results inline in the Commander terminal.

---

## 2) Review Console v1 → “Batch review surface” v2 (UX overhaul)

Current state is usable, but not “one-screen batch reviewing”.

Work needed:
- Make **Diff embed always on by default**, and treat “Open in new tab” as secondary. (DONE: PR #587)
- Add **filter/sort controls inside Review Console** (not just Queue). (DONE: this branch)
  - filters: tier/risk/unreviewed/blocked/claim
  - sort modes: queue order, risk+verify, verify desc, updated desc
  - quick “next unreviewed tier 3” navigation.
- Reduce vertical waste:
  - compact headers, tighten paddings, avoid tall meta blocks.
- Make terminal area more “review oriented”:
  - Agent + Server grouped (agent left, server right) with symmetric controls.
- Show “PR summary” in a compact strip:
  - title, repo, branch, checks status, draft, changed files count, additions/deletions.
- Improve file list:
  - render +/− with consistent colors, never show “-0” (DONE: PR #589)
  - add quick open-to-diff for a file (deep link into embedded diff viewer) (DONE: PR #589)

---

## 3) Terminal lifecycle + recovery correctness

Desired semantics:
- “Close” should not create infinite “recoverable sessions” clutter.
- “Remove worktree from workspace” should remove the whole group (agent+server+codex) and not leave orphans.

Work needed:
- Ensure **every** close/remove path clears recovery for the entire group:
  - close button in tiles
  - sidebar worktree remove
  - queue/review console remove
  - server/agent mismatch cases.
- Add a recovery policy:
  - default: only show sessions not explicitly closed
  - optionally show “closed (archived)” in a collapsible section.
- DONE: Settings now includes per-workspace “Prune old recoverables” (older-than-days) wired to recovery prune API.

---

## 4) Worktree inspector “Worktree files + commits” reliability

Symptoms:
- Button appears to do nothing in some cases.

Work needed:
- If session has no `cwd/worktreePath`, try resolving via workspace config: (DONE: PR #588)
  - mixed-repo terminal entry path
  - inferred repo root + worktreeId.
- When a PR exists but no local worktree exists, “Inspector” should fall back to PR console seamlessly. (DONE: PR #588)
- Add a toast that explains *why* it can’t open (missing path/PR link) instead of failing silently. (DONE: PR #588)

---

## 5) Branch label + color coding robustness

Symptoms:
- Branch label can stick on “unknown”.
- Color coding sometimes only appears after running a git command manually.

Work needed:
- Ensure branch refresh triggers from more git outputs (checkout/switch/gh checkout patterns).
- If a path is not a git repo, hide branch label entirely (instead of “unknown”) unless debug mode.
- Add an “Update branch now” quick action per worktree (manual refresh).

---

## 6) Theming / skins (“Blue mode” and beyond)

Goal:
- Support multiple “skins” (blue `#0f67fd` requested) that look great on both light and dark mode.
- A “skin intensity” control should tint neutral surfaces (not just accents).

Work needed:
- Formalize the theme token system:
  - enumerate all hard-coded colors and convert to CSS variables
  - document which variables a skin is allowed to override (`--skin-*` targets).
- Add more skins with tuned neutral surface targets:
  - blue (done), plus emerald/purple/amber (done) and a high-contrast option. (DONE: this branch)
- Add a “theme gallery” in Settings:
  - preview swatches, quick toggle, and a short explanation of intensity. (DONE: this branch)

---

## 7) Ticket actions and “move on merge”

Goal:
- If a PR is merged, optionally auto-move the linked ticket to a configured list (e.g. “For Test”).

Work needed:
- Make “move ticket” visible and easy in Review Console and Queue:
  - picker shows board + list names clearly
  - disable with explanation if ticket mapping missing
  - allow per-board mapping (already in settings) + a per-workspace default.
- Add an automation toggle:
  - on PR merge → move ticket (configurable destination list).

---

## 8) Known UX papercuts (small but important)

- Reduce or eliminate multiple “✕” close buttons that do different things without clarity.
- DONE: Queue action bar now wraps by group and keeps controls in-frame on narrower/shorter viewports (no hidden off-screen buttons).
- DONE: Settings panel now uses dynamic viewport height + mobile full-width fallback, keeping the full panel scrollable/usable on short viewports.
