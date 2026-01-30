# Remaining work from markdowns (added, full)

Generated (UTC): 2026-01-30

Goal: for markdown files **added to git in the last 7 days**, list anything that is **not explicitly marked done**.

This complements (does not replace) the checkbox/TODO scans:
- `PLANS/2026-01-30/REMAINING_WORK_FROM_NEW_MARKDOWNS_LAST_7_DAYS.md` (checkbox/TODO scan)
- `PLANS/2026-01-29/REMAINING_WORK_FROM_RECENT_MARKDOWNS.md` (human-curated “what’s left?” scan)

## Scope

“Added in the last 7 days” = files added to git since 2026-01-23 (inclusive):

```bash
git log --since="2026-01-23" --diff-filter=A --name-only -- ":(glob)**/*.md"
```

## Detection rules

1) Standard “remaining markers” (same as `scripts/scan-markdown-remaining.js`)
   - Unchecked task list items: `- [ ] ...` (and `* [ ] ...`)
   - `TODO` / `FIXME` tokens (case-insensitive)
2) “Future/backlog docs” that intentionally avoid checkboxes
   - If a file self-identifies as “future work/backlog” and says it intentionally has **no checkboxes**, we treat top-level bullet items as **unshipped work**, and list them here.

## Summary

- Scanned (added .md files): 32
- Files with actionable remaining work: 1
- Files with “unchecked” items that are templates (not backlog): 2
- Files with no remaining work: 29

---

## Files with actionable remaining work

### `PLANS/2026-01-30/GASTOWN_PARITY_BACKLOG.md`

Classification: **future backlog (no checkboxes by design)**.

Status note:
- “Activity feed: real-time event stream” is now shipped as **Activity Feed v1** (merged PRs #469–#476 on 2026-01-30).

Remaining work (unshipped):

**Phase 3A: Work distribution**
- Convoy dashboard: create/view/track convoys
- Sling interface: assign issues to agents
- Work queue visualization

**Phase 3B: Agent management**
- Polecat management panel: spawn/kill/view logs
- Polecat status dashboard
- Agent identity management

**Phase 3C: Monitoring**
- Hook browser: view/edit/repair hooks
- Deacon monitor: health dashboard

---

## Files with unchecked items (templates / guides — not backlog)

These files intentionally contain unchecked lists as *process checklists*.

### `PLANS/2026-01-24/CHECKLIST.md`

### `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`

---

## Files with no remaining work

- `PLANS/2026-01-24/FIZZY_UI_NOTES.md`
- `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`
- `PLANS/2026-01-24/TASKS_TICKETING.md`
- `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/DATA_MODEL.md`
- `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md`
- `PLANS/2026-01-25/POST_SHIP_ISSUES.md`
- `PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md`
- `PLANS/2026-01-25/PROMPT_ARTIFACTS_PR.md`
- `PLANS/2026-01-25/QUEUE_REVIEW_INBOX_PR.md`
- `PLANS/2026-01-25/REMAINING_NEXT_PHASE.md`
- `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`
- `PLANS/2026-01-25/TASK_RECORDS_PR.md`
- `PLANS/2026-01-25/TIER_FILTERS_PR.md`
- `PLANS/2026-01-25/TRELLO_PARITY_PR.md`
- `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`
- `PLANS/2026-01-25/WISHLIST_PHASE2.md`
- `PLANS/2026-01-25/WORKFLOW_MODES_PR.md`
- `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`
- `PLANS/2026-01-29/REMAINING_WORK_FROM_RECENT_MARKDOWNS.md`
- `PLANS/2026-01-30/PHASE3_TASKS.md`
- `PLANS/2026-01-30/REMAINING_WORK_FROM_ALL_MARKDOWNS.md`
- `PLANS/2026-01-30/REMAINING_WORK_FROM_LAST_7_DAYS_MARKDOWNS.md`
- `PLANS/2026-01-30/REMAINING_WORK_FROM_NEW_MARKDOWNS_LAST_7_DAYS.md`
- `PLANS/2026-01-30/REMAINING_WORK_SCAN_LAST_7_DAYS.md`

