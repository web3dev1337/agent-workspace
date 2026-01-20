# Implementation Plan (2026-01-20)

This plan converts `PLANS/2026-01-20/REQUESTED_CHANGES.md` into an executable, PR-by-PR roadmap.

## Ground Rules (Non‑Negotiables)

- **Do not impact your running instance** in `/home/ab/GitHub/tools/automation/claude-orchestrator/master` (port **3000**).
- Use this repo’s dev ports (**4000+**) and prefer **4001** for automated test servers.
- Ship in **small PRs**. Each PR:
  1) reproduces a single issue (or small cohesive set),
  2) fixes it,
  3) adds/updates tests (where reasonable),
  4) updates docs/logs,
  5) is merged before continuing.
- Maintain the rolling log in `PLANS/2026-01-20/ROLLING_LOG.md`.

## How We’ll Test (local)

### Unit tests
- `npm run test:unit`

### E2E tests (Playwright)
- Prefer: `npm run test:e2e:safe` (defaults to port 4001)
- Or: `ORCHESTRATOR_TEST_PORT=4001 npm run test:e2e`
- If we need the client dev-server: use a unique `CLIENT_PORT` (e.g. 2083+) and keep server on 4001+.

## Completed PRs (as of 2026-01-20)

- PR 79 — Planning docs: https://github.com/web3dev1337/claude-orchestrator/pull/79
- PR 80 — Safe E2E port (defaults to 4001): https://github.com/web3dev1337/claude-orchestrator/pull/80
- PR 81 — Preserve per-tab state (stop tab switches from wiping UI state): https://github.com/web3dev1337/claude-orchestrator/pull/81
- PR 82 — Sync backend workspace on tab activation: https://github.com/web3dev1337/claude-orchestrator/pull/82
- PR 83 — Prevent startup UI overlay resurrection: https://github.com/web3dev1337/claude-orchestrator/pull/83
- PR 84 — “Start Agent with Options” + default YOLO: https://github.com/web3dev1337/claude-orchestrator/pull/84
- PR 85 — Remove Yes/No quick actions UI: https://github.com/web3dev1337/claude-orchestrator/pull/85
- PR 86 — Refresh plans/log with merged PRs: https://github.com/web3dev1337/claude-orchestrator/pull/86
- PR 87 — Remove “Dynamic Layout” label: https://github.com/web3dev1337/claude-orchestrator/pull/87
- PR 88 — Prevent terminal scroll jump on tab switch: https://github.com/web3dev1337/claude-orchestrator/pull/88
- PR 89 — Update rolling log for PR 87/88: https://github.com/web3dev1337/claude-orchestrator/pull/89
- PR 90 — Remove sidebar “Services” section: https://github.com/web3dev1337/claude-orchestrator/pull/90
- PR 91 — Compact sidebar worktree list: https://github.com/web3dev1337/claude-orchestrator/pull/91

## Repo Understanding (High-level Architecture)

This repo is a Node/Express + Socket.IO backend (`server/`) with a plain JS frontend (`client/`) that renders:
- a dashboard,
- a tabbed multi-workspace UI,
- a terminal grid (xterm) for per-worktree sessions,
- and modals (ports/services, add worktree, conversation history, agent startup).

Core systems involved in your issues:
- Tab switching state isolation: `client/workspace-tab-manager.js`, `client/app.js`
- Terminal lifecycle/sizing: `client/terminal-manager.js`, `client/terminal.js`, `client/app.js`
- Worktree add + session wiring: `server/sessionManager.js`, `server/workspaceManager.js`, `client/app.js`
- Status detection & UI circles: `server/statusDetector.js`, `client/app.js`
- Cascaded config + custom buttons: `server/configDiscoveryService.js`, `client/app.js`
- Ports/services: `server/portRegistry.js`, `client/app.js`

## PR Roadmap

Order is chosen to fix reliability/state bugs first (tab switching + terminal integrity), then UI/UX enhancements, then broader productization (PR lists, favorites, “Agent Orchestrator” naming pass).

### PR 0 — Planning docs (done → PR 79)
**Goal:** Capture requirements + plan + checklist + rolling log to avoid context loss.
- Add:
  - `PLANS/2026-01-20/REQUESTED_CHANGES.md`
  - `PLANS/2026-01-20/IMPLEMENTATION_PLAN.md`
  - `PLANS/2026-01-20/CHECKLIST.md`
  - `PLANS/2026-01-20/ROLLING_LOG.md`

### PR 1 — Test isolation & safety rails (done → PR 80)
**Goal:** Make it harder to accidentally collide with port 3000 and easier to run tests on 4001+ consistently.
- Potential changes:
  - Ensure Playwright defaults to a “safe” port (4001) when `ORCHESTRATOR_PORT` isn’t set.
  - Add a `test:e2e:safe` script that sets `ORCHESTRATOR_PORT=4001`.
  - Ensure server startup in tests does not spawn the full dev stack (only server).
- Validate:
  - `npm run test:unit`
  - `npm run test:e2e` (with port override)

### PR 2 — Tab switching: preserve terminal integrity (typing + sizing) + sidebar selection (done → PR 81 + PR 82)
**Goal:** Fix the most disruptive bug: switching tabs corrupts terminals (layout/typing) and UI selection state.
- Likely work:
  - Audit tab state swap: ensure *all* per-tab state is saved/restored (sessions map, visibleTerminals, dismissedStartupUI, selected worktree, etc).
  - Ensure xterm `fit()` runs at the right times when showing a tab.
  - Confirm no DOM destruction on tab change (display toggling only).
  - Fix sidebar “selected worktree” radio state when switching tabs.
- Validate:
  - Manual: open workspace A, open workspace B tab, switch back/forth 10x; terminals remain interactive and sized correctly.
  - E2E: add/extend Playwright test for tab switching + typing.

### PR 3 — “Add worktree” should not resurrect startup overlays / reset terminals (done → PR 83)
**Goal:** Adding a worktree should append sessions without re-triggering startup UI or disturbing existing terminals.
- Likely work:
  - Confirm whether `sessions` event is re-fired on add and whether `handleInitialSessions()` resets per-session UI state.
  - Preserve `dismissedStartupUI` per session across session list updates.
  - Ensure add-worktree path uses “append” semantics only.
- Validate:
  - Manual: dismiss startup UI on work1, add worktree; startup UI does not reappear.
  - E2E: add test to reproduce and verify.

### PR 4 — Sidebar worktree list “one behind” update bug
**Goal:** Fix delayed sidebar updates after adding worktrees.
- Likely work:
  - Identify whether the client receives stale workspace config or whether the server emits updates in the wrong order.
  - Ensure the sidebar rebuild uses the latest authoritative list.
- Validate:
  - Manual add work4 → it appears immediately.
  - E2E: add test for sidebar update after add.

### PR 5 — Status indicator correctness pass
**Goal:** Define and implement correct status signals for the green/orange/gray circle(s).
- Deliverables:
  - Document status definition and sources (server status detector vs socket events).
  - Fix any mismatched state updates.
- Validate:
  - Manual: start/stop sessions; verify status changes.
  - Add unit test for status mapping if feasible.

### PR 6 — Remove/hide “Dynamic layout” control + fix/remove empty “Quick actions” strip
**Goal:** UI cleanup that reduces confusion and layout weirdness.

Status:
- Empty “Quick actions” strip + Yes/No UI removed in PR 85.
- “Dynamic layout” control still pending.

### PR 7 — Ports/Services modal redesign + remove bottom-left services list
**Goal:** A larger modal, card/grid layout, grouping, and quick actions (open/copy URL).
- Validate:
  - Manual: open modal, no micro-close, no forced scroll, copy actions work.

### PR 8 — Worktree picker modal redesign (large, grouped, favorites, recency filters)
**Goal:** Implement the requested worktree picker UX.
- Notes:
  - Likely incremental; we may split into PR 8a (layout + grouping), PR 8b (favorites + filters), PR 8c (sort + PR status).

### PR 9 — PR list view + “ready for review” tagging
**Goal:** Dedicated PR management UI with fast filters.

### PR 10 — “Agent Orchestrator” naming sweep (UI copy)
**Goal:** Rename UI text where it’s not Claude-specific.

### PR 11 — Agent detection (Claude vs Codex vs other) + Codex start command simplification
**Goal:** Improve agent awareness and reduce hard-coded Codex flags.

### PR 12 — Custom buttons + cascaded config wiring fixes + dynamic port selection
**Goal:** Make config-defined buttons reliable and support collision-free ports.

### PR 13 — Skill: project structure & creation workflow
**Goal:** Add a reusable skill markdown documenting your folder/worktree conventions.

### PR 14 — “Products” quick links (start from master, pull latest, start service, open/copy URL)
**Goal:** One-click productivity for “not actively developing” usage.

## Notes / Risks

- Several items depend on “real” filesystem structure under `~/GitHub`. Where automated tests can’t rely on your local tree, we’ll:
  - add lightweight fixture folders under `tests/fixtures/` (if feasible), or
  - make the grouping logic testable as pure functions.
- “Detecting Z.ai within Claude” is a stretch goal; we’ll treat it as best-effort.
