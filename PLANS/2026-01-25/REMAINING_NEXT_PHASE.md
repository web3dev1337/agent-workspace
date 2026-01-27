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

All requested “click click click” Task launch UX is now shipped.

Quality fixes shipped:
- ✅ Kanban and card detail panels stay left/right aligned (no “detail opens on the left” layout glitch).
- ✅ Kanban view opens left-aligned by default (no “single column stuck on the right” feel).

### Dashboard (project visibility)

- [ ] Project-level dashboard: per-project status, open PRs, review backlog, telemetry trends, and risk rollups.
- [ ] Long-term telemetry charts (trendlines, histograms) + export.

### Review workflow (automation)

- ✅ Auto reviewer→fixer→recheck loop v1 shipped (Queue toggles: Auto Reviewer / Auto Fixer / Auto Recheck).
- [ ] Richer notification modes (beyond toast-only) and “review complete” nudges.

### Integrations / automation

- [ ] Trello “board conventions” wizard (Done list naming, label/color mapping, dependency checklist policy).

---

## Safety + testing

- Worktree safety: keep changes on the dev worktree branch (do not touch the `/master` worktree).
- Tests:
  - `npm run test:unit`
  - `npm run test:e2e:safe`
