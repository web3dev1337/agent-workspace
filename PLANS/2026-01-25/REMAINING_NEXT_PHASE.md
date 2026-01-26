# Remaining Work (Next Phase)

Last updated: 2026-01-26

This is the “what’s left” list after the 2026-01-25 brain dump work that has already shipped (tiers/risk/prompt artifacts + Queue + telemetry + advisor + commander/voice + dependency graph).

Source context:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`

---

## Remaining items (previously not shipped)

Status: ✅ all items in this checklist are now implemented in the dev worktree as of 2026-01-26.

### Automation / Integrations

- [x] Trello automation on PR merge (auto-move cards, status conventions, optional comments/labels)
- [x] Policy + automation for prompt artifact pointers (auto-comment a short pointer on the Trello card when promoting to shared/encrypted)

### Worktrees / Capacity management

- [x] Auto-create `work9+` when all worktrees are busy (bounded by `global.ui.worktrees.autoCreateMaxNumber`)
- [x] Stronger “worktree in use” heuristics (cross-workspace + cross-repo, with explicit overrides)

### Review conveyor (v2+)

- [x] True “one-at-a-time” review conveyor belt (explicit WIP limits + queue lock/claim)
- [x] Notification modes (quiet vs aggressive; Tier 1 interrupts; “review complete” nudges)
- [x] Multi-agent review loop beyond v1 (e.g., reviewer → fixer → reviewer recheck with recorded outcome)

### Dashboard / Visibility

- [x] Dashboard v2: process summary (status/telemetry/advice) + queue shortcut
- [x] Cross-board / cross-project task view (aggregate selected lists/columns into a single pane)

### Dependency graph (v3+)

- [x] Unify Trello dependencies + orchestrator-native dependencies in one graph
- [x] Faster linking UX (import ticket deps, quick-search, bulk add)
- [x] Better graph features (cycle detection, pinning, filtering, “why blocked” drilldowns)

### Advisor (v2+)

- [x] Richer recommendations using telemetry trends + review outcomes + dependency graph signals
- [x] Optional “coach dashboards” (what to do next, what’s risky, what’s stuck)

---

## Safety + testing

- Worktree safety: keep changes on the dev worktree branch (do not touch the `/master` worktree).
- Tests:
  - `npm run test:unit`
  - `npm run test:e2e:safe`
