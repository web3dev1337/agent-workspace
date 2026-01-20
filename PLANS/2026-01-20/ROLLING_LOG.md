# Rolling Log (2026-01-20 → )

Purpose: keep a terse but complete log of what changed, why, and where to resume if context is lost.

## 2026-01-20

### Repo status / setup
- Working repo: `claude-orchestrator-dev/`
- Base branch: `origin/main`
- Created working branch: `many-changes` (tracks `origin/main`)
- Confirmed Z.ai toggle PR was merged into `main` (merge commit `d9406c0`).
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

### Tab switching backend sync (in progress)
- Goal: prevent terminal/output cross-contamination by switching the backend workspace when a workspace tab is activated.
- PR: https://github.com/web3dev1337/claude-orchestrator/pull/82
