# Rolling Log (2026-01-20 → )

Purpose: keep a terse but complete log of what changed, why, and where to resume if context is lost.

## 2026-01-20

### Repo status / setup
- Working repo: `claude-orchestrator-dev/`
- Base branch: `origin/main`
- Created working branch: `many-changes` (tracks `origin/main`)
- Confirmed Z.ai toggle PR was merged into `main` (merge commit `d9406c0`).
- `origin/main` HEAD (at time of writing): `7ca2113` (“Merge PR #85: remove Yes/No quick actions”)
- Confirmed dev instance ports are set in `.env` (server is **not** 3000).

### Planning docs
- Added: `PLANS/2026-01-20/REQUESTED_CHANGES.md`
- Added: `PLANS/2026-01-20/IMPLEMENTATION_PLAN.md`
- Added: `PLANS/2026-01-20/CHECKLIST.md`
- Added: `PLANS/2026-01-20/ROLLING_LOG.md`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/79
- Merged: commit `3f2e3cb22c4907e3917eb164cf96f0b5dca18753`

### Notes / next actions
- Next PR should likely be “Test isolation & safety rails” (ensure Playwright uses 4001+ by default).
- Highest priority runtime bug to tackle early: workspace tab switching corrupts xterm sizing / input + sidebar selection.

---

## 2026-01-20 (later)

### Test isolation / safety rails (done)
- Goal: default Playwright to a safe test port (4001) and keep API calls aligned.
- Changes:
  - Added `ORCHESTRATOR_TEST_PORT` support for Playwright.
  - Added `npm run test:e2e:safe` helper.
  - Updated e2e tests to use `ORCHESTRATOR_TEST_PORT` when present.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/80
- Merged: commit `d13dfde339e9e7dacd07677822acff9d235e749c`

### Tab switching state preservation (done)
- Goal: prevent tab creation/switching from wiping the previous tab’s per-workspace UI state (sessions, PR links, server status, startup UI dismissal).
- Changes:
  - Store/restore more per-tab state in `WorkspaceTabManager` (Maps/Sets).
  - Avoid clearing global orchestrator state before the previous tab is hidden/snapshotted.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/81
- Merged: commit `ce9e4dcb2505257bbc0ed512107c86fa583ee4fc`

### Tab switching backend sync (done)
- Goal: prevent terminal/output cross-contamination by switching the backend workspace when a workspace tab is activated.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/82
- Merged: commit `e662f6ef671a638d6788b9d34b2c0cd78a280136`

### Startup UI overlay resurrection (done)
- Goal: stop the “Fresh/Continue/Resume” startup overlay from reappearing after reconnects or worktree additions.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/83
- Merged: commit `79eba5627b50c74a1e20db4a880dc35f1c45fab8`

### Start Agent options label + default YOLO (done)
- Goal: rename the ↻ “Start Claude with Options” tooltip to “Start Agent with Options” and default YOLO checked in the agent startup modal.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/84
- Merged: commit `7e593d7772c797ebe1f309afed4ac229f32a50ce`

### Remove Yes/No quick actions (done)
- Goal: remove the bottom Yes/No buttons (and the “waiting for my answer” quick-action UX) since everything runs in YOLO mode now.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/85
- Merged: commit `7ca2113`

### Notes / follow-ups
- We removed the **Yes/No UI** + empty quick-actions strip. If the underlying “waiting for yes/no” detection is still causing issues, we can remove that logic next.
- New report: sometimes terminal scroll jumps all the way to the top unexpectedly (needs repro + fix).

---

## 2026-01-20 (continued)

### UI cleanup: remove “Dynamic Layout” label (done)
- Removed the non-functional “Dynamic Layout” header label.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/87
 - Merged: commit `2d3c218`

### Terminal: prevent scroll jumping to top on tab switches (done)
- Hypothesis: on tab switch, we restore a stale `viewportY` even when the user was at the bottom; if output arrived while tab was hidden, restoring forces the terminal up (can look like jumping to the top).
- Fix approach: track whether the user was at bottom when leaving; restore scroll only when they were scrolled up.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/88
- Merged: commit `28c39a3`

### Sidebar: remove bottom-left services list (done)
- Removed the left sidebar “🔌 Services” section (under worktrees). Use the top-right Ports button instead.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/90
- Merged: commit `1e10187`

### Sidebar: compact worktree rows + fix status dot colors (done)
- Make worktree rows single-line (remove per-row Claude/Server sub-status rows).
- Change agent status dot mapping to match `server/statusDetector.js` semantics: waiting=green, busy=orange, idle=gray.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/91
- Merged: commit `9c52434`

---

## 2026-01-21

### Docs: dev instance must not touch `master/` (done)
- Added an explicit rule in `CLAUDE.md` that when developing in `claude-orchestrator-dev/` (feature branches / PRs), treat `~/GitHub/tools/automation/claude-orchestrator/master` as **run-only**.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/93
- Merged: commit `49e81bd`

### Mixed worktree add: prevent terminal “reset” (done)
- Reworked `POST /api/workspaces/add-mixed-worktree` to be additive:
  - No `initializeSessions()` (which cleared all sessions)
  - Emits `worktree-sessions-added` with only the new sessions
- Client includes `socketId` so the backend can target the requesting UI when possible.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/94
- Merged: commit `830f385`

### Sidebar: active-only filter works for mixed-repo worktrees (done)
- Fixed `isWorktreeActive()` / `showActiveWorktreesOnly()` to use the same mixed-repo worktree key as the sidebar (`RepoName-workN`), preventing “active only” mode from hiding mixed-repo worktrees.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/95
- Merged: commit `e64f023`

### Status: align UI colors with `StatusDetector` (done)
- Defined status color variables in `client/styles.css` and aligned terminal header status colors with `server/statusDetector.js` semantics:
  - `waiting` → green
  - `busy` → orange
  - `idle` → gray
  - `error` → red
- Removed the client-side `waiting` → `ready` remap so the UI uses the real status values consistently.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/97
- Merged: commit `07143cd`

### UI: modal close buttons are usable (done)
- Added shared modal header + close button styles (`.modal-header`, `.close-btn`) to make the close affordance larger and consistent across modals (ports, worktree picker, conversation history).
- Tests: `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/98
- Merged: commit `81a7bb2`

### UI copy: “Claude Orchestrator” → “Agent Orchestrator” (done)
- Updated the visible app title (page `<title>` + header) and dashboard heading to “Agent Orchestrator”.
- Renamed the per-worktree “🤖 Claude” terminal label to “🤖 Agent” (the dropdown still controls Claude vs Codex).
- Updated Playwright title assertion to match.
- Tests: `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/99
- Merged: commit `a4ec556`

### Commander terminal: Ctrl/Cmd+V pastes text (done)
- Added explicit copy/paste key handlers to the Commander XTerm:
  - Ctrl/Cmd+C copies selection
  - Ctrl/Cmd+V reads clipboard text + sends to Commander
- Goal: prevent the “no image found in clipboard” behavior and allow normal text paste.
- Tests: `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/101
- Merged: commit `2b3f9bc`

### Docs: mark Commander paste fix complete (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/102
- Merged: commit `5177214`

### Dashboard navigation: one-click dashboard + back to tabs (done)
- Added a header button `🏠 Dashboard` to open the dashboard in one click.
- Added a dashboard “← Back to Workspaces” button (when tabs exist) that restores the current tabbed workspace view without forcing a workspace re-open.
- ESC on the dashboard returns to the tabbed view when available.
- Tests: `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/103
- Merged: commit `6a3bf9a`

### Docs: mark dashboard navigation done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/104
- Merged: commit `f58dee6`

### Docs: add PR 100-104 to plan (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/105
- Merged: commit `0046a10`

### Ports/Services modal: larger grid + copy actions (done)
- Make the Ports/Services modal wide and grid-based to reduce scrolling.
- Add per-service actions: open in browser, copy URL, copy port.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/106
- Merged: commit `675362c`

### Docs: update checklist/log for PR 106 (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/107
- Merged: commit `93a537e`

### Quick Worktree modal: larger to reduce scrolling (done)
- Increased the “Quick Work” worktree picker modal size to reduce scrolling.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/108
- Merged: commit `4e2ac9f`

### Docs: update plans/log for PR 108 (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/109
- Merged: commit `9d428e8`

### Docs: capture Commander paste requirement (done)
- Add the missing “Commander Ctrl/Cmd+V paste text” item to the requested changes source-of-truth doc.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/110
- Merged: commit `2e7a238`
