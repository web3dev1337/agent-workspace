# Phase 3 tasks (remaining backlog)

Generated: 2026-01-30  
Source: `PLANS/2026-01-29/REMAINING_WORK_FROM_RECENT_MARKDOWNS.md`

Guidelines:
- One PR per task (merge frequently; keep worktree clean).
- Keep scope tight; add follow-up tasks instead of bloating a PR.
- Prefer server+UI increments that are testable with `npm run test:unit`.

## Process / workflow

- [x] **P3-01 Pairing recommendations v1**: add `GET /api/process/pairing` (Tier 2/3 safe pairings) + minimal Queue UX entrypoint.
  - Output shape: ranked pairs + reason codes (conflicts/context distance).
  - Sources: `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`, `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`

- [x] **P3-02 Overnight runner preset v1**: Tier 4 “overnight” preset (run tests + leave summary/checklist).
  - Sources: `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`

## Risk / conflicts

- [ ] **P3-03 Ticket↔ticket conflict probability v1 (heuristics)**: compute/estimate potential conflicts between tickets.
  - Note: explicitly deferred previously; do as a small, explainable heuristic first.
  - Source: `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`

## Dependencies

- [ ] **P3-04 Shared/encrypted task records store v1**: support shared/encrypted storage + “promote private → shared”.
  - Source: `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md`

- [ ] **P3-05 Dependency satisfaction rules v1**: richer satisfaction for `worktree:` / `session:` dependencies (infer completion).
  - Source: `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md`

## Tasks / Trello parity

- [ ] **P3-06 Attachments + cover images v1**: show attachments + cover in Tasks UI (read-only first).
  - Sources: `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`, `PLANS/2026-01-25/TRELLO_PARITY_PR.md`

- [ ] **P3-07 Checklist CRUD v1**: full checklist CRUD (not just Dependencies convention).
  - Sources: `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`, `PLANS/2026-01-25/TRELLO_PARITY_PR.md`

- [ ] **P3-08 List create/reorder v1**: create lists + reorder lists in Tasks UI.
  - Source: `PLANS/2026-01-25/TRELLO_PARITY_PR.md`

- [ ] **P3-09 Within-list drag reorder v1**: true within-list reorder (pos math) + optional WIP limits/swimlanes follow-ups.
  - Sources: `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`, `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`

- [ ] **P3-10 Persistent SWR cache v1**: stale-while-revalidate cache persisted across restarts.
  - Sources: `PLANS/2026-01-24/TASKS_TICKETING.md`, `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`

## Done (shipped)

- [x] **P2 Four Queues snapshot surfaced**: BWQX chip + `/api/process/status.fourQueues` (PR #431)
