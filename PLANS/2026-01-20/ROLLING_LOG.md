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

### Notes / next actions
- Next PR should likely be “Test isolation & safety rails” (ensure Playwright uses 4001+ by default).
- Highest priority runtime bug to tackle early: workspace tab switching corrupts xterm sizing / input + sidebar selection.
