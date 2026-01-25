# Tier Filters (PR)

## Goal
Make the **Tier 1–4 workflow visible and usable** in the day-to-day orchestrator UI by:
- showing tier badges on the sidebar worktree list
- adding fast tier filter buttons (radio-style) to the sidebar filter area
- applying tier filtering as a **second-layer filter** (like Agent/Server view mode) so it never destroys per-worktree visibility toggles

## Design
- Tier source-of-truth remains **task records** (`/api/process/task-records`).
- Tier resolution for a terminal/session:
  1) PR record (`pr:owner/repo#num`) if session has an associated PR URL
  2) worktree record (`worktree:<cwd>`) if session has `config.cwd`
  3) session record (`session:<sessionId>`)

## UX
- Sidebar filter row adds: `All T1 T2 T3 T4 None`
- Sidebar worktree rows show `Q{tier}` badge when tier exists
- Tier filtering affects:
  - sidebar list visibility
  - terminal grid visibility (`isSessionVisibleInCurrentView`)

## Testing
- `npm run test:e2e:safe` (existing suite)
- Manual: toggle tier filter and confirm grid/sidebar update without losing per-worktree hide/show state

## Resume notes
- Sidebar build: `client/app.js` `buildSidebar()`
- Tier resolution helpers: `client/app.js` `getTierForSession()`
