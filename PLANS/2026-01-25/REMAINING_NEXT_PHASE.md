# Remaining Work (Next Phase)

Last updated: 2026-01-27

This is the “what’s left” list after the core 2026-01-25 brain dump work shipped (tiers/risk/prompt artifacts + Queue + telemetry/advice + tasks→launch + dependency graph + commander/voice).

Source context:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`

---

## Still missing / next phase (larger items)

### Tasks (ticket UX)

- [ ] Multi-board “combined view”: choose specific lists/columns across boards and show them together (standardized naming / minimal scrolling).
- [ ] Faster per-card “launch preset” UI (optional): quick pick tier/agent/mode without relying on global defaults/hotkeys.

### Dashboard (project visibility)

- [ ] Project-level dashboard: per-project status, open PRs, review backlog, telemetry trends, and risk rollups.
- [ ] Long-term telemetry charts (trendlines, histograms) + export.

### Review workflow (automation)

- [ ] Auto reviewer→fixer→recheck loop (beyond manual buttons), including outcomes stored on the task record.
- [ ] Richer notification modes (beyond toast-only) and “review complete” nudges.

### Integrations / automation

- [ ] Optional webhook-driven PR merge automation (instead of polling), with configurable Trello conventions per board.
- [ ] Trello “board conventions” wizard (Done list naming, label/color mapping, dependency checklist policy).

---

## Safety + testing

- Worktree safety: keep changes on the dev worktree branch (do not touch the `/master` worktree).
- Tests:
  - `npm run test:unit`
  - `npm run test:e2e:safe`
