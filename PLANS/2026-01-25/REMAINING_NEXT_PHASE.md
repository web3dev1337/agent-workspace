# Remaining Work (Next Phase)

Last updated: 2026-01-28

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
- ✅ Kanban and card detail panels stay left/right aligned (no “detail opens on the left” layout glitch). (PR #290)
- ✅ Kanban view opens left-aligned by default (no “single column stuck on the right” feel). (PR #290)

Known issues / follow-ups:
- [x] Status indicator lights (green/orange/grey) can flicker or be inaccurate while agents/worktrees are active. (Mitigated in PR #315; further stabilized in PR #328; remaining edge cases may exist)
- [x] Status indicator UI: delay busy→waiting transitions to reduce flicker (PR #353)
- [x] Intermittent: card detail layout may still reflow or appear on the wrong side. (Hardened in PR #298; direction enforced in PR #327. If it still happens, capture view (List/Board/Combined) + screenshot.)
- [x] Add “Start server” control to the Agent terminal header (one click; mirrors Server window controls). (PR #277)
- [x] Tasks panel: add a quick “Open Trello board” link/button for the currently selected board. (PR #279)
- [x] Add-worktree modal: support “Add & close” and “Add another” (keep adding without modal churn), and refresh availability immediately. (PR #285)
- [x] Removing a worktree from a workspace should remove both terminals immediately (no F5 needed). (PR #281)
- [x] Tasks panel: default assignee filter to “All” (not “me”). (PR #283)
- [x] Tasks panel: add an obvious “New task” button. (PR #287)
- [x] Board Settings: repo mapping includes a dropdown of detected local repos to fill Local path (manual entry still supported). (PR #384)
- [x] Worktree “quick add” should re-evaluate after a new worktree is created (avoid suggesting the just-created worktree as “free”). (PR #289)
- [x] Worktree “quick add”: allow “create N worktrees” (e.g., 5 at once) + optional background start (“quick work in background”). (PR #292)
- [x] Trello boards: confirm board background / color theming remains consistent per-board (if applicable). (PR #300)
- [x] Tasks board “wrap/expand” layout: re-check column auto-layout to ensure it minimizes columns (considers collapsed/hidden lists and fills vertically before adding columns). (PR #294)

### Dashboard (project visibility)

- [x] Project-level dashboard: per-project status, open PRs, review backlog, telemetry trends, and risk rollups. (PR #275)
- [x] Long-term telemetry charts (trendlines, histograms) + export. (PR #302)
- [x] Telemetry: task `createdAt` + summary `createdCount` signal. (PR #352)

### Review workflow (automation)

- ✅ Auto reviewer→fixer→recheck loop v1 shipped (Queue toggles: Auto Reviewer / Auto Fixer / Auto Recheck).
- ✅ Review Console: merge PR button (docked Worktree Inspector). (PR #372)
- ✅ Review Console: move ticket/card (Done + list picker) (board conventions + task record update). (PR #374, #380)
- ✅ Review Console: review timer + outcome + notes controls. (PR #376)
- ✅ Queue: “Auto Console” toggle auto-opens Review Console while navigating. (PR #378)
- [x] Richer notification modes (beyond toast-only) and “review complete” nudges. (PR #274)

### Integrations / automation

- [x] Trello “board conventions” wizard (Done list naming, label/color mapping, dependency checklist policy). (PR #273)
- [x] Trello PR-merge conventions: optional comment template, label(s), and checklist item (PR #326, #333, #336)

---

## Safety + testing

- Worktree safety: keep changes on the dev worktree branch (do not touch the `/master` worktree).
- Tests:
  - `npm run test:unit`
  - `npm run test:e2e:safe`
