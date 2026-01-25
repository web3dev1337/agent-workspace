# Queue / Review Inbox (PR)

## Goal
Add a dedicated **Queue / Review Inbox** UI that lets you quickly:
- See an at-a-glance count of Tier 1–4 (plus “No tier”)
- Filter/search items (PRs/worktrees/sessions)
- Edit task record metadata (`tier`, `changeRisk`, `pFailFirstPass`, `verifyMinutes`, `promptRef`)
- Open the Prompt Artifact editor for the selected item
- Jump to GitHub PR and/or the local Advanced Diff Viewer

This is the first UI step toward the tiered workflow (T1–T4) and “review conveyor belt” flow.

## What this PR changes
- Adds a new header button: **📥 Queue**
- Adds a new Queue modal (reusing the Tasks modal layout/styles):
  - Left column: list + tier counts + search
  - Right column: editor for tier/risk/pFail/verify/promptRef
  - “Diff” button opens `:7655/pr/:owner/:repo/:prNumber` when item is a PR
  - “Prompt” opens a local prompt editor backed by `/api/prompts/:id`

## API dependencies (already in `main`)
- `GET /api/process/tasks?mode=mine|all&state=open`
- `PUT /api/process/task-records/:id`
- `GET|PUT /api/prompts/:id`

## Testing
Run on dev worktree only (do not touch the prod `/master` worktree):
- `node -c client/app.js`
- `npm run test:e2e:safe -- tests/e2e/queue-panel.spec.js`

## Checklist
- [ ] Queue button visible in header
- [ ] Queue panel opens/closes cleanly (Esc + X)
- [ ] List renders + tier counts update when search filters change
- [ ] Selecting an item shows detail editor
- [ ] Edits persist via `PUT /api/process/task-records/:id`
- [ ] Prompt editor loads/saves via `/api/prompts/:id`
- [ ] “Diff” opens Advanced Diff Viewer for PR items

## Resume notes
If context is lost:
- Look at `client/app.js` `showQueuePanel()`
- E2E coverage: `tests/e2e/queue-panel.spec.js`
