# Remaining work from markdowns (added)

Generated (UTC): 2026-01-31

Sort: files with remaining items first; files with no remaining items at the bottom.

Detection:
- Unchecked task list items: `- [ ] ...` (and `* [ ] ...`)
- `TODO` / `FIXME` tokens (case-insensitive)
- Heuristic “remaining” sections: headings like “What’s left / Remaining / Still missing / Next steps / To do”, followed by bullet/numbered items

Scope: markdown files added in the last 10 days via git history.

## Summary
- Scanned: 31
- With remaining markers: 10
- With no remaining markers: 21

## Files with remaining items

### `PLANS/2026-01-24/CHECKLIST.md`

- Remaining markers: 12 (unchecked: 12, TODO/FIXME: 0)
- Classification: template/guide

**Unchecked**
- PLANS/2026-01-24/CHECKLIST.md:6 — Running instance in \`.../claude-orchestrator/master\` is not touched
- PLANS/2026-01-24/CHECKLIST.md:7 — Dev/test ports avoid 3000 (use 4001+ for tests)
- PLANS/2026-01-24/CHECKLIST.md:10 — \`npm run test:unit\`
- PLANS/2026-01-24/CHECKLIST.md:11 — \`npm run test:e2e:safe\` (or note why skipped)
- PLANS/2026-01-24/CHECKLIST.md:14 — Dashboard loads
- PLANS/2026-01-24/CHECKLIST.md:15 — Workspaces load and terminals type normally
- PLANS/2026-01-24/CHECKLIST.md:16 — Quick Work modal works
- PLANS/2026-01-24/CHECKLIST.md:17 — PR list works
- PLANS/2026-01-24/CHECKLIST.md:20 — Commit message is scoped and clear
- PLANS/2026-01-24/CHECKLIST.md:21 — Pushed to \`origin\`
- PLANS/2026-01-24/CHECKLIST.md:22 — PR opened
- PLANS/2026-01-24/CHECKLIST.md:23 — PR URL recorded in rolling log (if applicable)

### `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`

- Remaining markers: 10 (unchecked: 7, TODO/FIXME: 0)
- Classification: template/guide

**Unchecked**
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:91 — \`T1+T2\` (Tier 1+2 review pressure). If \`T1+T2 > 3\`: **no Tier 1/2 launches** (review first).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:92 — \`T3\` and \`T4\`: respect their own caps (Tier 3 batch + Tier 4 dedicated).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:93 — \`WIP\` (active projects). If \`WIP > WIP_max\`: freeze new projects; finish/kill.
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:94 — Pick 1 Tier 1 focus block (90–120 min).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:95 — Pick up to 2 Tier 2 gap fillers (same project if possible).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:96 — Pick Tier 3 batch candidates (non-conflicting, small, safe).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:97 — Pick at most 1 Tier 4 overnight candidate (tests required).

**Heuristic “Remaining” sections**
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:246 — 6) Next Deliverable
  - PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:249 — start with WIP/Q visibility + gating (fast to implement, huge ROI)
  - PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:250 — then tier tagging and queue view
  - PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:251 — then batch review mode

### `PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md`

- Remaining markers: 7 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:298 — P4-CMD-02 — Add “Queue operations” commands (select/next/prev/open console/diff)
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:300 — \`queue/open\`
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:301 — \`queue/select\` \`{ id }\`
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:302 — \`queue/select-by\` \`{ kind: 'pr'|'ticket'|'record', value }\` (PR URL/#, ticket URL, etc.)
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:303 — \`queue/next\`, \`queue/prev\`
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:304 — \`queue/open-diff\`
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:305 — \`queue/open-console\` (Review Console)
  - PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md:306 — \`queue/open-inspector\`

### `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`

- Remaining markers: 6 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:247 — Next recommended PRs (small, shippable)
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:249 — **Prompt artifact promotion**
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:250 — private → shared/encrypted + pointer comment policy (Trello)
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:251 — **Review workflow expansion**
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:252 — mark reviewed, request changes, launch fix agent
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:253 — **Automation rules**
  - PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md:254 — e.g. hide Tier 3/4 while Tier 1 busy; simple launch gating

### `PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md:49 — Follow-ups (next PRs)
  - PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md:50 — Multi-store sharing: shared/encrypted task records in a repo (team-visible) + “promote private → shared”
  - PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md:51 — Richer satisfaction rules for worktree/session dependencies (derive completion from tags/PR state)
  - PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md:52 — Dependency graph view + “what’s unblocked next” ordering (review conveyor belt)

### `PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md:104 — Next steps (ties into tier workflow)
  - PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md:106 — Add task/PR-level \`changeRisk\` + \`pFailFirstPass\` and compute \`overallRisk\`.
  - PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md:107 — Add a “Review Inbox” view sorted by \`overallRisk\` and “time to verify”.
  - PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md:108 — Use conflict API to warn when two tiered tasks overlap in a repo.

### `PLANS/2026-01-25/REMAINING_NEXT_PHASE.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/REMAINING_NEXT_PHASE.md:1 — Remaining Work (Next Phase)
  - PLANS/2026-01-25/REMAINING_NEXT_PHASE.md:8 — \`PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md\`
  - PLANS/2026-01-25/REMAINING_NEXT_PHASE.md:9 — \`PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md\`
  - PLANS/2026-01-25/REMAINING_NEXT_PHASE.md:10 — \`PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md\`

### `PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md:1 — Next PR Plan: Trello Tasks (Metadata + Edits + Dependencies)
  - PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md:8 — Kanban v1 plan: \`PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md\`
  - PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md:9 — Provider/API notes: \`PLANS/2026-01-24/TASKS_TICKETING.md\`
  - PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md:10 — Fizzy inspiration: \`PLANS/2026-01-24/FIZZY_UI_NOTES.md\`

### `PLANS/2026-01-25/WORKFLOW_MODES_PR.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-25/WORKFLOW_MODES_PR.md:48 — Follow-ups (next PRs)
  - PLANS/2026-01-25/WORKFLOW_MODES_PR.md:49 — Mode-specific sorting (overallRisk, verifyMinutes)
  - PLANS/2026-01-25/WORKFLOW_MODES_PR.md:50 — Auto-show Tier 2 only while Tier 1 agents are busy (requires stronger agent↔task binding)
  - PLANS/2026-01-25/WORKFLOW_MODES_PR.md:51 — Merge/request-changes actions from within Queue (GitHub API integration)

### `PLANS/2026-01-30/PHASE3_TASKS.md`

- Remaining markers: 3 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-30/PHASE3_TASKS.md:1 — Phase 3 tasks (remaining backlog)
  - PLANS/2026-01-30/PHASE3_TASKS.md:7 — One PR per task (merge frequently; keep worktree clean).
  - PLANS/2026-01-30/PHASE3_TASKS.md:8 — Keep scope tight; add follow-up tasks instead of bloating a PR.
  - PLANS/2026-01-30/PHASE3_TASKS.md:9 — Prefer server+UI increments that are testable with \`npm run test:unit\`.

## Files with no remaining items
- `PLANS/2026-01-24/FIZZY_UI_NOTES.md`
- `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`
- `PLANS/2026-01-24/TASKS_TICKETING.md`
- `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/DATA_MODEL.md`
- `PLANS/2026-01-25/POST_SHIP_ISSUES.md`
- `PLANS/2026-01-25/PROMPT_ARTIFACTS_PR.md`
- `PLANS/2026-01-25/QUEUE_REVIEW_INBOX_PR.md`
- `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`
- `PLANS/2026-01-25/TASK_RECORDS_PR.md`
- `PLANS/2026-01-25/TIER_FILTERS_PR.md`
- `PLANS/2026-01-25/TRELLO_PARITY_PR.md`
- `PLANS/2026-01-25/WISHLIST_PHASE2.md`
- `PLANS/2026-01-30/GASTOWN_PARITY_BACKLOG.md`
- `PLANS/2026-01-30/GASTOWN_PARITY_TASKS.md`
- `PLANS/2026-01-31/DISCORD_BOT_INTEGRATION_PLAN.md`
- `PLANS/2026-01-31/PHASE4_FULL_UI_CONTROL.md`
- `PLANS/2026-01-31/THEMING_SKINS_BLUE_MODE_PLAN.md`
- `PLANS/2026-01-31/UI_COLOR_AUDIT.md`
