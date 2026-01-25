# PR Plan: Orchestrator Task Records (Tier/Risk/pFail/PromptRef)

Branch: `feat/task-records`

Goal: add an orchestrator-native store for workflow metadata that **does not require Trello**.

This enables:
- tier tagging (T1–T4) for PRs/worktrees/sessions
- storing `changeRisk`, `baseImpactRisk` (when available), and `pFailFirstPass`
- storing `verifyMinutes` (review cost)
- storing `promptRef` + `promptVisibility` pointer (private/shared/encrypted)

It is intentionally minimal (API + storage). UI comes later.

## API

- `GET /api/process/task-records`
- `GET /api/process/task-records/:id`
- `PUT /api/process/task-records/:id` (upsert)
- `DELETE /api/process/task-records/:id`

Process task list enrichment:
- `GET /api/process/tasks` now returns `task.record` if a record exists for that task id.

## Storage

Local file:
- `~/.orchestrator/task-records.json`

Keying:
- PR: `pr:<owner>/<repo>#<number>`
- worktree: `worktree:<worktreePath>`
- session: `session:<sessionId>`

## Fields (v0)

- `tier`: `1..4`
- `changeRisk`: `low|medium|high|critical`
- `baseImpactRisk`: `low|medium|high|critical` (when present; project-level risk is handled elsewhere)
- `pFailFirstPass`: `0..1`
- `verifyMinutes`: integer minutes
- `promptRef`: string pointer to prompt artifact
- `promptVisibility`: `private|shared|encrypted`
- `title`: label (may be omitted)
- `linked`: arbitrary JSON for ticket/PR references (may be omitted)
- `notes`: freeform notes (may be omitted)

## Tests

- Unit: `tests/unit/taskRecordService.test.js`
