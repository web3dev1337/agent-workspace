# Rolling Log (2026-01-20 → )

Purpose: keep a terse but complete log of what changed, why, and where to resume if context is lost.

## 2026-01-25

### Tasks panel: Trello Kanban board + write ops diagnostics (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/179
- Notes:
  - Adds board snapshot API + board view toggle + drag/drop moves (optimistic UI).
  - Fix: add-comment uses form body (more reliable) and errors from Trello are surfaced back to the UI.
  - Fix: card update/move errors now include Trello status/details for debugging.
  - Fix: Tasks API calls no longer hard-code port 3000 (works with whatever port the UI is served on; client dev server proxies `/api`).
  - Tests: added e2e coverage for client-dev-server proxy mode (`npm run test:e2e:proxy`).
  - Plan for next work (metadata + dependencies): `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`

### Tasks panel: Trello parity (labels/custom fields, assignees filter, avatars, layouts) (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/180
- Notes:
  - Adds labels + custom field editing, assignee filtering (“Only me” / “Any”), Trello avatar sizing fix, kanban layout modes, per-board collapse persistence.
  - E2E tests mock user settings per test to avoid cross-test flake.

### Project risk metadata + conflict detection (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/181
- Adds:
  - project/base impact risk (`low|medium|high|critical`) via cascaded `.orchestrator-config.json` + local override support via `~/.orchestrator/project-metadata.json`
  - worktree metadata enriched with `project.baseImpactRisk`
  - `POST /api/worktree-conflicts` minimal conflict signals (file overlap / parallel PRs / parallel dirty)
  - Quick Work menu displays risk indicator
- Resume doc: `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`

### Docs: resume-safe workflow status (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/182

### Process: task records API (tier/risk/pFail/promptRef) (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/183

### Prompts: prompt artifacts API + Trello embed (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/184

### Queue: Review Inbox (tiers + risk + prompt refs) (merged)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/185

## 2026-01-24

### Tasks panel: Trello ticketing provider (v0) (merged)
- Adds a provider-agnostic Tasks API (`/api/tasks/*`) with a first read-only Trello provider (boards/lists/cards + card detail).
- Adds a minimal “✅ Tasks” modal to browse provider → board → list → cards, with a details pane.
- Credentials (local only): `TRELLO_API_KEY` + `TRELLO_TOKEN` (or `~/.trello-credentials`).
- Caching: in-memory TTL cache (reduces API calls).
- Docs: `PLANS/2026-01-24/TASKS_TICKETING.md`
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/178

### Terminal layout: avoid fitting while hidden (done)
- Symptom: after hiding/showing a worktree (or other UI that temporarily hides terminals), existing terminal output can appear “bunched up” due to a tiny intermediate resize.
- Fix: treat any hidden-by-layout terminal as non-fit-able (not just `wrapper.style.display = 'none'`), and observe `.terminal-body` size changes so refits trigger reliably after layout changes.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/170
- Merged: commit `12dca52`

### Quick Work modal: allow selecting “in use” worktrees (done)
- Goal: keep “in use” visibility as an indicator, but do not block selection in the advanced worktree picker.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/171
- Merged: commit `a6955bd`

### Docs: optimal orchestrator workflow + roadmap (done)
- Added: `PLANS/2026-01-24/*` and refined queue/tier model + four-queues mapping.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/172
- Merged: commit `1d7cf2f`

### Process layer primitives: task abstraction (done)
- Added unified “task” model across:
  - PRs (via `gh search prs`)
  - worktrees tagged ready-for-review
  - sessions in `waiting` status
- Added endpoint: `GET /api/process/tasks`
- Refactored: `GET /api/prs` → `PullRequestService`
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/173
- Merged: commit `bf53e98`

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

### Docs: log PR 109-110 (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/111
- Merged: commit `5eb3ab1`

### Worktree picker: group repos by folder structure (done)
- Group “Quick Work” repo list by top-level folder (games/websites/tools/etc) and inferred framework subgroups.
- Hide empty groups during search filtering.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/112
- Merged: commit `67cd195`

### Docs: mark worktree grouping done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/113
- Merged: commit `a60cf48`

### Worktree picker: sort + recency filters (done)
- Added fast-click radio controls for sorting (edited/created) and filtering by “edited within” (7d/1m/2m/3m/6m/1y).
- Persisted selections in localStorage.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/114
- Merged: commit `c987cfe`

### Docs: mark sort/recency done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/115
- Merged: commit `73658e3`

### Worktree picker: favorites (done)
- Added ⭐ favorites to “Quick Work” (persisted) and a “Favorites only” toggle.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/116
- Merged: commit `d05a520`

### Docs: mark favorites done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/117
- Merged: commit `8397cee`

### Worktree picker: quick launch oldest/recent/choose (done)
- Added a split-button menu to start oldest / start most recent / choose any worktree for a repo.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/118
- Merged: commit `4d7e908`

### Docs: mark quick launch done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/119
- Merged: commit `234b0bc`

### Worktree picker: show branch + PR status (done)
- Added branch + PR state badges to the Quick Worktree choose menu (open/draft/merged/closed).
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/120
- Merged: commit `d981598`

### Docs: mark branch/PR status done (done)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/121
- Merged: commit `0525cd9`

### PR management: PR list view (done)
- Added a PR list modal (mine by default) with a toggle to include others and filters for open/closed/all.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/122
- Merged: commit `cc422cf`

### PR management: ready-for-review tagging (done)
- Added a per-worktree “R” toggle in the sidebar to mark a worktree **ready for review** (persisted by worktree path).
- Added backend storage in `~/.orchestrator/worktree-tags.json` and API routes:
  - `GET /api/worktree-tags`
  - `POST /api/worktree-tags/ready`
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/124

### YOLO-only: remove Yes/No waiting detection (done)
- Removed legacy “yes/no” / `(y/N)` prompt detection from status detection to prevent false “waiting for your input” states and related UI churn.
- Removed legacy `suggestedActions: ['yes','no',...]` from waiting notifications metadata.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/125

### Naming: “Claude Orchestrator” → “Agent Orchestrator” UI copy (done)
- Updated notification titles and the View Presets modal to use “Agent” wording where it’s not provider-specific.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/126

### Agents: simplify Codex quick start defaults (done)
- Removed hard-coded Codex `model` / `reasoning` / `verbosity` from the inline quick-start config so Codex can manage defaults.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/127

### Agents: show detected agent type in sidebar (done)
- Server now includes `agent` / `agentMode` in session state (sourced from session recovery’s `lastAgent`).
- Sidebar worktree rows show an icon for the last detected agent (Claude/Codex/OpenCode/Aider).
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/128

### Config: worktree cascades include project layer (done)
- Fixed `WorkspaceManager.getCascadedConfigForWorktree()` to merge **Global → Category → Framework → Project → Worktree** (previously missing the project layer).
- This unblocks per-project config-driven buttons showing up in worktree terminals (plus any worktree-specific overrides).
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/129

### Skill: folder/worktree conventions (done)
- Added skill `skills/public/orchestrator-worktree-conventions/SKILL.md` with supporting examples in `skills/public/orchestrator-worktree-conventions/references/layout.md`.
- Validated skill structure with `quick_validate.py`.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/130

### Ports: dynamic port selection avoids collisions (done)
- Port allocation uses `server/portRegistry.js` (8080–8199) with lsof-based availability checks and a per-(repoPath,worktreeId) cache.
- Server start flow uses `PortRegistry.suggestPort()` and falls back to the next free port if the preferred one is taken.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/131

### Quick Links: “Products” launcher (done)
- Added `products` to `~/.orchestrator/quick-links.json` and exposed CRUD via `/api/quick-links/products`.
- Added `/api/products/launch` to `git pull --ff-only` in the configured `masterPath` and then run `startCommand` (logs to `logs/products/<productId>.log`).
- Safety: refuses to run inside the orchestrator production `~/GitHub/tools/automation/claude-orchestrator/master`.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/132

### Terminals: preserve width after hide/show (done)
- Fixes a bug where toggling a worktree off/on could shrink the terminal to ~10 columns and hard-wrap output.
- Root cause: `fitTerminal()` could run while the wrapper was `display:none`, resizing the PTY to tiny dimensions.
- Fix: skip fitting when the wrapper is hidden; if the container is still too small after retries, skip instead of “fit anyway”.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/133

### Worktree add (advanced): preserve visibility + allow selecting “in use” (done)
- Fixes two UX issues when adding a worktree via **Quick Work → Advanced**:
  - Adding a worktree could reset the user’s hide/show toggles (all worktrees visible again) if a `sessions` refresh arrived for the same workspace.
  - Worktrees marked “In use” were disabled; now they’re selectable and will simply re-show the existing worktree in the current workspace.
- Changes:
  - Preserve per-workspace `visibleTerminals` state across `sessions` refreshes for the same `workspaceId` (new sessions default visible).
  - `isWorktreeInUse()` only considers sessions from the current workspace.
  - “In use” buttons are no longer disabled; clicking them reveals the existing sessions instead of blocking.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/134

### Terminal grid: allow scrolling when >16 visible (done)
- Fixes the “tiny slivers at the bottom” issue when more than 16 terminals are visible (extra rows were being clipped because the grid used `overflow:hidden` and only defined layouts up to 16).
- Adds a `terminal-grid-scrollable` mode when `data-visible-count > 16`:
  - Enables vertical scrolling
  - Uses fixed-ish `grid-auto-rows` so terminals remain usable
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/135

### Terminals: never resize PTY to tiny dimensions (done)
- Further hardens terminal sizing against transient layout states (e.g. sidebar/tab/layout changes) that briefly produce tiny row/col counts.
- Behavior: we still fit xterm, but we **skip resizing the PTY** if the computed size is below a safe minimum (prevents irreversible hard-wrapped output).
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/136

### PRs panel: repo/owner filters + merged/closed split (done)
- Header → **🔀 PRs** now supports:
  - Scope: Mine / Include others / All
  - State: Open / Merged / Closed (unmerged) / All
  - Sort: Updated / Created
  - Filters: `repo` and `owner` (comma-separated)
  - Actions: ↗ Open (GitHub) + 🔍 Diff (local diff viewer)
- Backend `/api/prs` now supports: `mode=all`, `state=merged`, `sort=created`, `repo=...`, `owner=...`.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/138

### Diff viewer: gh auth fallback + fixed start scripts (done)
- Fixed `diff-viewer/start-diff-viewer.sh` to run from the repo (no hardcoded HyFire2 path) and build the client bundle if needed.
- Diff viewer GitHub API now falls back to `gh api` when `GITHUB_TOKEN` is not set (works with `gh auth` for private repos).
- Docs updated: `diff-viewer/START_HERE.md`
- Tests: `npm run test:unit`, `npm run test:e2e:safe`, diff-viewer smoke (`node test-diff-engines.js`)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/140

### Diff viewer: rich text analysis (server, non-breaking) (done)
- Enhanced the text diff engine to compute “rich” operations: Updates (paired -/+), Moves (exact block move), Copy/Paste (repeated added lines), Find/Replace (repeated token substitutions).
- Kept backwards compatibility by continuing to return `type: "text"` with `changes` + `stats`, while attaching `analysis.richText` for the richer representation.
- Added smoke script: `diff-viewer/test-rich-text.js`
- Tests: `node diff-viewer/test-rich-text.js`, `node diff-viewer/test-diff-engines.js`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/142

### Diff viewer: rich diff UI (done)
- Added a new `RichDiffView` UI that renders:
  - Hunk headers + line numbers
  - Updated lines as paired -/+ with inline segment highlights
  - Summary badges + small lists for find/replace, moves, and copy/paste
- Added a **Rich Diff** toggle (default on). Uses **Hide Noise** to collapse unchanged context lines.
- Tests: `npm --prefix diff-viewer/client run build`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/143

### Terminals: avoid transient tiny fits (done)
- Further reduces “bunched up” terminal output and fit warnings after layout transitions (e.g. hide/show worktrees sidebar).
- Uses `fitAddon.proposeDimensions()` + last-known-good cols heuristic to avoid fitting while the DOM/font/layout is unstable.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/145

### Diff viewer: auto-start on open (done)
- Clicking the 🔍 button now starts the diff viewer if it’s not running and redirects the new tab once ready.
- Adds:
  - `POST /api/diff-viewer/ensure`
  - `GET /api/diff-viewer/status`
  - `server/diffViewerService.js` (spawns `diff-viewer/start-diff-viewer.sh`, logs to `logs/diff-viewer.log`)
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/147

### Diff viewer: fix cache fallback (no native SQLite) (done)
- Fixes `500` errors when `better-sqlite3` can’t load (Node version mismatch). We now fall back to an in-memory cache instead of using sqlite3 with an incompatible sync API.
- This unblocks `GET /api/github/pr/:owner/:repo/:pr` and all downstream diff analysis.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/149

### Diff viewer: start automatically with orchestrator (done)
- `npm start` now auto-starts the diff viewer in the background by default (disable with `AUTO_START_DIFF_VIEWER=false`).
- Playwright tests set `AUTO_START_DIFF_VIEWER=false` to avoid extra background processes.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/150

### Diff viewer: review UX (header sizing + scroll navigation) (done)
- Fixes a flex/CSS issue where the per-file header could take most of the right panel.
- Adds a single scroll container plus a “Wheel advances files” mode so you can scroll through diffs file-by-file without constant clicking.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`, `npm --prefix diff-viewer/client run build`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/152

### Diff viewer: rebuild client when stale (done)
- Fixes a “stale UI” issue: `start-diff-viewer.sh` used to build the client only when `client/dist` was missing, which meant pulling updates could still serve old JS/CSS.
- Now the script rebuilds when `client/src` (or key config files) are newer than `client/dist/index.html`.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/154

### Diff viewer: render updates as split rows + rebuild client on ensure (done)
- Rich Diff “updated” operations now render as a single split row (old vs new) instead of two stacked +/- rows, reducing noise for small edits.
- Orchestrator `POST /api/diff-viewer/ensure` now also rebuilds the diff-viewer client bundle when stale so UI-only changes apply even if the diff-viewer server is already running.
- Tests: `npm run test:unit`, `npm --prefix diff-viewer/client run build`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/156

### Conversation browser: autocomplete dropdown no longer blocks first result (done)
- Clicking anywhere outside the search input now dismisses the autocomplete dropdown so it doesn't cover/cut off the first result.
- Escape hides autocomplete first; Escape again closes the modal.
- Ensures dismiss listeners are cleaned up even when the modal closes via “Resume”.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/157

### Sidebar worktree list: remove extra icons + tighten layout (done)
- Removed the agent icon (🤖/⚡) and visibility icon from the worktree sidebar row to reduce clutter.
- Kept a single status dot and tightened padding/font sizing.
- Repo/worktree/branch labels should now truncate less aggressively (and show full values on hover via tooltips).
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/158

### View mode (Agent/Servers): second-layer filter (done)
- Makes **Agent Only / Servers Only / View All** a second-layer filter that does *not* modify per-worktree hide/show (left sidebar).
- New worktrees added after selecting a view mode respect the current mode (e.g., Servers Only keeps agent terminals hidden).
- Adds active styling to the view mode buttons.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/160

### Dashboard: real “Last used” per workspace (done)
- Workspace switches now persist `workspace.lastAccess` so the dashboard can show accurate last-used times.
- Older workspace configs backfill `lastAccess` from workspace JSON file mtime (best-effort) so existing cards aren’t all “never”.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/162

### Commander panel: Ctrl/Cmd+V paste always inserts text (done)
- Commander paste now uses the `paste` event (`clipboardData`) instead of `navigator.clipboard.readText()` for better reliability across browsers/webviews.
- Prevents default xterm paste handling to avoid double-paste and the “no image found” style failure modes.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/164

### Dashboard: show repo visibility (public/private/team) (done)
- Server enriches workspace entries with GitHub repo visibility using `gh repo view` (cached), falling back to unauth GitHub API for public repos.
- Dashboard now displays `unknown` instead of defaulting everything to `private` when no access info is available.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/166

### Docs: clarify “Agent Orchestrator” branding (done)
- Updates top-level docs titles to use “Agent Orchestrator” while noting the repo remains `claude-orchestrator`.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/168

### Quick Work: allow selecting “in use” worktrees (done)
- Quick Worktree menu no longer disables “in use” entries; selecting one shows the existing sessions (or falls back to adding it) instead of blocking.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/171

### Tasks: Trello Kanban board view + metadata + writes (merged)
- Adds a full-screen Tasks modal with Trello provider support, board snapshot + kanban view, and common write actions (comments/move/assign/due/dependencies).
- Includes server-side theme setting (`global.ui.theme`) and Trello color accents + labels/members/custom fields read-only display.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/179 (merged 2026-01-25)

### Tasks: Trello parity iteration (labels + custom field editing) (merged)
- Adds label editing (board labels list + card label toggles).
- Adds custom field editing (text/number/checkbox/date/list) via provider-agnostic API.
- Makes Tasks API calls port-agnostic in split dev (no hard-coded `:3000` inside Tasks panel).
- Test updates: unit tests for Trello provider writes + new e2e mocks for label/custom-field edits.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/180 (merged 2026-01-25)

### Workflow: Focus/Review/Background modes + Queue Next/Prev (merged)
- Adds a header workflow toggle:
  - Focus (Tier 1–2), Review (all; opens Queue), Background (Tier 3–4)
- Adds Queue navigation buttons (Prev/Next) and orders unblocked items first.
- Persists selection to `userSettings.global.ui.workflow.mode`.
- Tests: `npm run test:unit`, `npm run test:e2e:safe -- tests/e2e/workflow-modes.spec.js`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/189

### Workflow: dynamic Focus Tier-2 gating + review outcomes (merged)
- Focus includes `T2 Auto | T2 Always` to hide Tier 2 while Tier 1 is busy.
- Queue adds review controls (tier scope, unreviewed filter, auto diff, start review) and persists `reviewedAt` + `reviewOutcome`.
- Tests: `npm run test:unit`, `npm run test:e2e:safe -- tests/e2e/review-workflow.spec.js`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/191 (merged 2026-01-25)

### Docs: remove “optional” language everywhere (PR)
- Removes “optional/optionally” wording in docs/plans so the backlog reads as mandatory items.
- Updates older docs where they described steps/variables as optional.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/192

### Process: WIP + Q banner in header (merged)
- Adds `/api/process/status` with cached WIP + tiered queue counts.
- Adds a click-to-open header pill that shows `WIP`, `Q1–Q4`.
- Tests: `npm run test:unit`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/193

### Process: launch gating on overload (merged)
- Adds `launchAllowedByTier` to `/api/process/status`.
- Before starting any agent, prompts if workload caps are exceeded (Tier 1–2 uses `Q12`, Tier 3 uses `Q3`, Tier 4 uses `Q4`).
- Tests: `npm run test:unit`, `npm run test:e2e:safe -- tests/e2e/launch-gating.spec.js`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/194

### Docs: log PRs 193–194 (merged)
- Updates rolling log + workflow status docs to include PRs 193 and 194.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/195 (merged 2026-01-25)

### Chore: morning-safe ports + stable E2E (merged)
- Default `npm start` / `npm run dev` runs web-only (avoid Tauri/Cargo failures); Tauri is still available via `npm run dev:full`.
- Adds safe dev helper `npm run dev:web:safe` (server `:4001`, client `:4100`) so dev work doesn’t collide with the live `/master` instance (often `:3000`).
- Makes `npm run test:e2e:safe` auto-pick a free port (starting `:4001`) and support `-- <playwright args>` passthrough.
- Suppresses noisy git stderr from non-repo folders during startup.
- Tests: `npm run test:unit`, `npm run test:e2e:safe`
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/196 (merged 2026-01-25)

### UI: tier dropdown on Agent tiles (merged)
- Adds a per-Agent tier dropdown (`None/Q1–Q4`) directly on each Agent tile; persists to task records under `session:<id>`.
- Updates sidebar + terminal grid immediately so Focus/Review/Background gating reacts without opening Queue.
- Tests: `npm run test:unit`, `npm run test:e2e:safe` (adds `tests/e2e/inline-tier-selector.spec.js`)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/198 (merged 2026-01-25)

### Fix: prevent terminal fit while containers are tiny (merged)
- Avoids fitting xterm while the terminal container is a tiny “sliver” during hide/show and tab/layout transitions (prevents hard wrapping into a narrow column).
- Improves resize observation by watching the terminal wrapper element.
- Tests: `npm run test:unit`, `npm run test:e2e:safe` (adds `tests/e2e/terminal-fit-guard.spec.js`)
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/200 (merged 2026-01-25)
