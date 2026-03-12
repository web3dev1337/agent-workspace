# Remaining work from markdowns (recent)

Generated (UTC): 2026-01-31

Sort: files with remaining items first; files with no remaining items at the bottom.

Detection:
- Unchecked task list items: `- [ ] ...` (and `* [ ] ...`)
- `TODO` / `FIXME` tokens (case-insensitive)
- Heuristic “remaining” sections: headings like “What’s left / Remaining / Still missing / Next steps / To do”, followed by bullet/numbered items

Scope: markdown files touched in the last 10 days via git history.

## Summary
- Scanned: 55
- With remaining markers: 17
- With no remaining markers: 38

## Files with remaining items

### `REVISED_WORKSPACE_PLAN.md`

- Remaining markers: 16 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- REVISED_WORKSPACE_PLAN.md:1744 — 🎯 Next Steps
  - REVISED_WORKSPACE_PLAN.md:1746 — **Review & Prioritize**:
  - REVISED_WORKSPACE_PLAN.md:1747 — Confirm phases match your priorities
  - REVISED_WORKSPACE_PLAN.md:1748 — Adjust timeline if needed
  - REVISED_WORKSPACE_PLAN.md:1749 — Identify must-have vs nice-to-have features
  - REVISED_WORKSPACE_PLAN.md:1751 — **Set Up Development Environment**:
  - REVISED_WORKSPACE_PLAN.md:1752 — Create \`feature/multi-workspace\` branch
  - REVISED_WORKSPACE_PLAN.md:1753 — Set up \`.orchestrator/\` directory structure
  - REVISED_WORKSPACE_PLAN.md:1754 — Create migration script
  - REVISED_WORKSPACE_PLAN.md:1756 — **Start Phase 1**:
  - REVISED_WORKSPACE_PLAN.md:1757 — Implement \`WorkspaceManager\`
  - REVISED_WORKSPACE_PLAN.md:1758 — Create migration script
  - REVISED_WORKSPACE_PLAN.md:1759 — Test backward compatibility
  - REVISED_WORKSPACE_PLAN.md:1761 — **Iterate**:
  - REVISED_WORKSPACE_PLAN.md:1762 — Build → Test → Get Feedback → Refine
  - REVISED_WORKSPACE_PLAN.md:1763 — Ship working increments
  - REVISED_WORKSPACE_PLAN.md:1764 — Don't wait for perfection

### `PLANS/2026-01-24/CHECKLIST.md`

- Remaining markers: 12 (unchecked: 12, TODO/FIXME: 0)
- Classification: template/guide

**Unchecked**
- PLANS/2026-01-24/CHECKLIST.md:6 — Running instance in \`.../claude-orchestrator/master\` is not touched
- PLANS/2026-01-24/CHECKLIST.md:7 — Dev/test ports avoid 9460 (use 9480+ for tests)
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

### `PLANS/2026-01-20/CHECKLIST.md`

- Remaining markers: 11 (unchecked: 11, TODO/FIXME: 0)
- Classification: template/guide

**Unchecked**
- PLANS/2026-01-20/CHECKLIST.md:7 — Branch created from updated \`main\`
- PLANS/2026-01-20/CHECKLIST.md:8 — Issue reproduced and documented (notes in \`PLANS/2026-01-20/ROLLING_LOG.md\`)
- PLANS/2026-01-20/CHECKLIST.md:9 — Fix implemented with minimal scope
- PLANS/2026-01-20/CHECKLIST.md:10 — Unit tests run: \`npm run test:unit\`
- PLANS/2026-01-20/CHECKLIST.md:11 — E2E tests run on safe port: \`npm run test:e2e:safe\` (or justified skip)
- PLANS/2026-01-20/CHECKLIST.md:12 — Manual sanity check (focused, <5 minutes)
- PLANS/2026-01-20/CHECKLIST.md:13 — Docs updated (requirements/plan/log as needed)
- PLANS/2026-01-20/CHECKLIST.md:14 — Commit created (clear message)
- PLANS/2026-01-20/CHECKLIST.md:15 — Pushed to \`origin\`
- PLANS/2026-01-20/CHECKLIST.md:16 — PR opened (record PR URL in rolling log)
- PLANS/2026-01-20/CHECKLIST.md:17 — PR merged

### `IMPLEMENTATION_STATUS.md`

- Remaining markers: 10 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- IMPLEMENTATION_STATUS.md:463 — 💡 TIPS FOR NEXT SESSION
  - IMPLEMENTATION_STATUS.md:465 — **Start by fixing SessionManager** - The hardcoded references need to be removed
  - IMPLEMENTATION_STATUS.md:467 — **Test workspace switching via console first**:
  - IMPLEMENTATION_STATUS.md:475 — **Create a simple test workspace** for testing:
  - IMPLEMENTATION_STATUS.md:490 — **Dashboard should be simple first** - Just show workspace names, click to switch. Polish later.
  - IMPLEMENTATION_STATUS.md:492 — **Use existing UI patterns** - Look at how sidebar and terminal grid are built, follow same patterns.
  - IMPLEMENTATION_STATUS.md:494 — **Commit frequently** - Every component working = commit.
- IMPLEMENTATION_STATUS.md:614 — Next Priority Tasks:
  - IMPLEMENTATION_STATUS.md:615 — **Extract HyFire settings** to JSON template
  - IMPLEMENTATION_STATUS.md:616 — **Create template renderer** (replace 1000+ line HTML string in app.js)
  - IMPLEMENTATION_STATUS.md:617 — **Add website and writing templates**
  - IMPLEMENTATION_STATUS.md:618 — **Test with different workspace types**

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

### `PLANS/2026-01-20/ROLLING_LOG.md`

- Remaining markers: 8 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PLANS/2026-01-20/ROLLING_LOG.md:102 — Notes / next actions
  - PLANS/2026-01-20/ROLLING_LOG.md:103 — Next PR should likely be “Test isolation & safety rails” (ensure Playwright uses 9480+ by default).
  - PLANS/2026-01-20/ROLLING_LOG.md:104 — Highest priority runtime bug to tackle early: workspace tab switching corrupts xterm sizing / input + sidebar selection.
- PLANS/2026-01-20/ROLLING_LOG.md:566 — Workflow: Focus/Review/Background modes + Queue Next/Prev (merged)
  - PLANS/2026-01-20/ROLLING_LOG.md:567 — Adds a header workflow toggle:
  - PLANS/2026-01-20/ROLLING_LOG.md:568 — Focus (Tier 1–2), Review (all; opens Queue), Background (Tier 3–4)
  - PLANS/2026-01-20/ROLLING_LOG.md:569 — Adds Queue navigation buttons (Prev/Next) and orders unblocked items first.
  - PLANS/2026-01-20/ROLLING_LOG.md:570 — Persists selection to \`userSettings.global.ui.workflow.mode\`.
  - PLANS/2026-01-20/ROLLING_LOG.md:571 — Tests: \`npm run test:unit\`, \`npm run test:e2e:safe -- tests/e2e/workflow-modes.spec.js\`
  - PLANS/2026-01-20/ROLLING_LOG.md:572 — PR: https://github.com/web3dev1337/claude-orchestrator/pull/189

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

### `PR_SUMMARY.md`

- Remaining markers: 7 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- PR_SUMMARY.md:144 — Next Steps
  - PR_SUMMARY.md:146 — **Merge to main** when ready for production
  - PR_SUMMARY.md:147 — **Optional enhancements**:
  - PR_SUMMARY.md:148 — 3-layer button customization (game → framework → project specific)
  - PR_SUMMARY.md:149 — Workspace templates library
  - PR_SUMMARY.md:150 — Cloud config synchronization
  - PR_SUMMARY.md:151 — Advanced notification center
  - PR_SUMMARY.md:152 — Per-workspace Claude model selection

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

### `IMPLEMENTATION_PLAN.md`

- Remaining markers: 5 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- IMPLEMENTATION_PLAN.md:935 — Next Steps
  - IMPLEMENTATION_PLAN.md:937 — **Review this document** with user (you)
  - IMPLEMENTATION_PLAN.md:938 — **Confirm priorities**: Which phases are most critical?
  - IMPLEMENTATION_PLAN.md:939 — **Start Phase 1**: Implement WorkspaceManager backend
  - IMPLEMENTATION_PLAN.md:940 — **Iterate**: Build, test, get feedback, improve
  - IMPLEMENTATION_PLAN.md:941 — **Document as we go**: User guide, API docs, video tutorials

### `WORKSPACE_ANALYSIS.md`

- Remaining markers: 5 (unchecked: 0, TODO/FIXME: 0)
- Classification: doc/backlog

**Heuristic “Remaining” sections**
- WORKSPACE_ANALYSIS.md:895 — Next Steps
  - WORKSPACE_ANALYSIS.md:897 — **User Validation**: Review this document with you to confirm requirements
  - WORKSPACE_ANALYSIS.md:898 — **Prioritization**: Identify which phases are most critical
  - WORKSPACE_ANALYSIS.md:899 — **Phase 1 Kickoff**: Begin implementing WorkspaceManager
  - WORKSPACE_ANALYSIS.md:900 — **Iterative Development**: Build one phase, get feedback, iterate
  - WORKSPACE_ANALYSIS.md:901 — **Documentation**: Create user guide as features are built

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
- `CLAUDE.md`
- `COMMANDER_CLAUDE.md`
- `COMPLETE_IMPLEMENTATION.md`
- `COWORKER_SETUP_GUIDE.md`
- `COWORKER_SETUP.md`
- `diff-viewer/README.md`
- `diff-viewer/START_HERE.md`
- `DOCUMENTATION.md`
- `GAP_ANALYSIS_2026-01-17.md`
- `IMPLEMENTATION_NOTES.md`
- `IMPROVEMENT_ROADMAP.md`
- `PLANS/2026-01-20/IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-20/REQUESTED_CHANGES.md`
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
- `QUICK_START.md`
- `README.md`
- `scripts/windows-launchers/README.md`
- `SYSTEM_OVERVIEW_PRESENTATION.md`
