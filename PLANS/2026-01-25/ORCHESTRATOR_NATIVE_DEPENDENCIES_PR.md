# Orchestrator-Native Dependencies (PR)

## Goal
Support **dependencies between Tier 1–4 tasks** even when a task has **no Trello card**.

This enables:
- greenfield/T4 work with no ticket
- dependencies between PR ↔ PR, PR ↔ worktree, session ↔ PR, etc.
- a “blocked/unblocked” view in the review queue
- CLI/API access so agents can read/write dependencies and reason about “what’s next”

## Storage
Dependencies are stored in **task records**:
- Local store: `~/.orchestrator/task-records.json`
- Field: `dependencies: string[]` (task IDs, e.g. `pr:owner/repo#123`, `worktree:/abs/path`, `session:abc123`)
- Completion override: `doneAt` timestamp (lets you mark arbitrary tasks as complete even if they’re not a PR)

## Dependency satisfaction rules (v1)
A dependency is **satisfied** if:
- dep record has `doneAt`, OR
- dep is a PR (`pr:owner/repo#num`) and GitHub says it is **merged**

Everything else is treated as **not satisfied** until a `doneAt` is set (or future automation is added).

## API
New endpoints:
- `GET /api/process/task-records/:id/dependencies`
  - returns resolved dependencies with `satisfied` + `reason`
- `POST /api/process/task-records/:id/dependencies`
  - body: `{ dependencyId: string }`
- `DELETE /api/process/task-records/:id/dependencies/:depId`

Extensions:
- `GET /api/process/tasks?include=dependencySummary`
  - adds `dependencySummary: { total, blocked }` for each task

## UI
Queue (`📥 Queue`) improvements:
- List rows show dependency summary (blocked count)
- Detail panel shows dependencies (add/remove) + “Done” toggle

## Tests
- Unit:
  - task record normalization for `dependencies` + `doneAt`
  - dependency satisfaction logic (PR merged, doneAt overrides)
- E2E (safe port):
  - Queue shows blocked count + add/remove dependency updates server

## Follow-ups (next PRs)
- Multi-store sharing: shared/encrypted task records in a repo (team-visible) + “promote private → shared”
- Richer satisfaction rules for worktree/session dependencies (derive completion from tags/PR state)
- Dependency graph view + “what’s unblocked next” ordering (review conveyor belt)
