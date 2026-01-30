# Remaining Work Found in Recently-Created Plan Docs (Last 7 Days)

Generated: 2026-01-29  
Last updated: 2026-01-30  
Repo state: `origin/main` @ `f56a170`

## Scope + method

“Markdown files created within the last week” = files **added to git** since 2026-01-22:
`git log --since="2026-01-22" --diff-filter=A --name-only -- ":(glob)**/*.md"`

For each file, this scan:
1) Extracted items that were **not explicitly marked done** (unchecked checkboxes, and “Missing / Follow-ups / Next steps / Out of scope / v2 / later” notes).
2) De-duped + validated against current code (routes + basic greps).

Notes:
- Some files are **templates** (intentionally unchecked) or **historical transcripts** (not an actionable checklist). Those are called out explicitly.
- “Implemented differently than described” is treated as **done** if the capability exists.

---

## Remaining work (deduped)

### Process layer / workflow

1) **Safe-parallelism “pairing” recommendations (conflict probability + context distance)**
   - Roadmap calls for `GET /api/process/pairing` (ranked safe pairings for Tier 2/3) and heuristics for `q(i,j)` / `d(i,j)`.
   - Current: minimal conflicts exist (`POST /api/worktree-conflicts`), but there is no `/api/process/pairing` endpoint or pairing UX.
   - Sources:
     - `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md` (PR 0.3)
     - `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md` (Conflict + context distance)
     - `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md` (ticket-level conflicts: “missing future work”)

2) **Explicit “Four Queues” (B/W/Q/X) snapshot surfaced for diagnosis**
   - Roadmap/spec describes a B/W/Q/X (“Backlog / In-flight / Review / Rework”) snapshot to explain overload states.
   - Current: telemetry has created/done/outcomes, but there is no explicit B/W/Q/X breakdown surfaced as such.
   - Sources:
     - `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md` (PR 0.2)
     - `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md` (Four Queues model)

3) **Tier 4 “Overnight runner” preset (YOLO + run tests + leave summary/checklist)**
   - Current: no “overnight runner” preset/command is present.
   - Source:
     - `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md` (Overnight runner preset)

### Risk / conflicts

4) **Ticket↔ticket “conflict probability” heuristic layer (future)**
   - Current: explicitly deferred; not implemented.
   - Source:
     - `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md` (Ticket-level conflicts → “❌ Missing (future work)”)

### Dependencies

5) **Shared/encrypted task records store + promote private → shared**
   - Current: task records are local-only (`~/.orchestrator/task-records.json`).
   - Source:
     - `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md` (Follow-ups)

6) **Richer satisfaction rules for worktree/session dependencies**
   - Current: dependency satisfaction is `doneAt` or PR merged; worktree/session completion inference is not implemented.
   - Source:
     - `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md` (Follow-ups)

### Tasks / Trello parity

7) **Attachments + cover images support**
   - Current: no attachments/cover support exists in Tasks UI/API.
   - Sources:
     - `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md` (Follow-ups)
     - `PLANS/2026-01-25/TRELLO_PARITY_PR.md` (Follow-ups)
     - `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md` (Out of scope)

8) **Full checklist CRUD (beyond Dependencies convention)**
   - Current: Dependencies checklist is supported; “all checklists” CRUD is not.
   - Sources:
     - `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md` (Follow-ups)
     - `PLANS/2026-01-25/TRELLO_PARITY_PR.md` (Follow-ups)

9) **List creation/reorder**
   - Current: lists are fetched, but list create/reorder isn’t exposed.
   - Source:
     - `PLANS/2026-01-25/TRELLO_PARITY_PR.md` (Follow-ups)

10) **True within-list drag reorder (pos math), plus swimlanes/WIP limits**
   - Current: Trello `pos` is supported at the API layer, but there’s no “perfect reorder” UI/logic, swimlanes, or WIP limits.
   - Sources:
     - `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md` (Follow-ups)
     - `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md` (Out of scope)

11) **Persistent/stale-while-revalidate cache (+ persistence across restarts)**
   - Current: Tasks provider caching is in-memory TTL only.
   - Sources:
     - `PLANS/2026-01-24/TASKS_TICKETING.md` (Future)
     - `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md` (Design decisions)

---

## Per-file scan results (what we found)

### Files with remaining work

#### `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`
- Remaining: items #1–#2 above (pairing heuristics + explicit B/W/Q/X snapshot).

#### `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`
- Template daily checklist items are intentionally unchecked (not backlog).
- Remaining: items #1–#3 above (pairing heuristics, four-queues snapshot surfacing, overnight runner).

#### `PLANS/2026-01-24/TASKS_TICKETING.md`
- Remaining: item #11 above (persistent/stale-while-revalidate cache).

#### `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`
- Remaining: items #7–#10 above (attachments/cover, full checklist CRUD, “perfect reorder”).

#### `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md`
- Remaining: items #5–#6 above (shared/encrypted task records; richer satisfaction rules).

#### `PLANS/2026-01-25/TRELLO_PARITY_PR.md`
- Remaining: items #7–#10 above (attachments/cover, full checklist CRUD, list reorder/creation, within-list reorder).

#### `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`
- Remaining: items #7, #10, #11 above (attachments/cover, within-list reorder, persistent cache).

#### `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`
- Remaining: item #4 above (ticket↔ticket conflict probability heuristics: explicitly “missing future work”).

### Files with no remaining work (or reference/templates only)

#### `PLANS/2026-01-24/CHECKLIST.md`
- Template checklist (intentionally unchecked); not a product backlog.

#### `PLANS/2026-01-24/FIZZY_UI_NOTES.md`
- No remaining work. The referenced patterns (drag/drop + collapsible columns) are already present in the current Tasks UI.

#### `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- Historical transcript; not an actionable checklist. (The shippable plan/checklist lives in `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`.)

#### `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- No remaining work (all checklist items are marked shipped).

#### `PLANS/2026-01-25/DATA_MODEL.md`
- Reference doc; no remaining work items.

#### `PLANS/2026-01-25/POST_SHIP_ISSUES.md`
- No remaining work (all items are checked off).

#### `PLANS/2026-01-25/PROMPT_ARTIFACTS_PR.md`
- No remaining work from this doc (prompt artifacts + promotion + Trello embed are already shipped).

#### `PLANS/2026-01-25/QUEUE_REVIEW_INBOX_PR.md`
- No remaining work (checklist is fully checked off).

#### `PLANS/2026-01-25/REMAINING_NEXT_PHASE.md`
- No remaining work (all items are checked off).

#### `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`
- No remaining work (the described v1 capabilities are now shipped).

#### `PLANS/2026-01-25/WORKFLOW_MODES_PR.md`
- No remaining work (follow-ups shipped: Queue PR actions + review-mode risk/verify sorting).

#### `PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md`
- No remaining work (overallRisk + Queue sorting + conflict warnings are now shipped).

#### `PLANS/2026-01-25/TASK_RECORDS_PR.md`
- No remaining work (task records API is shipped).

#### `PLANS/2026-01-25/TIER_FILTERS_PR.md`
- No remaining work (tier filters + resolution helpers are shipped).

#### `PLANS/2026-01-25/WISHLIST_PHASE2.md`
- No remaining work (all items are checked off).
