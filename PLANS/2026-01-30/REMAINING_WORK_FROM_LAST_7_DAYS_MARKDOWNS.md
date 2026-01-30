# Remaining work from markdowns (last 7 days)

Generated: 2026-01-30

Scope: markdown files touched by commits in the last 7 days (via `git log --since='7 days ago' -- '*.md'`).

Detection rules:
- Unchecked task list items: `- [ ] ...` (and `* [ ] ...`)
- `TODO` / `FIXME` tokens (case-insensitive)

## Files with remaining items

### IMPLEMENTATION_STATUS.md

- Unchecked: 35
- TODO/FIXME: 0

**Unchecked**

- IMPLEMENTATION_STATUS.md:351 — `client/dashboard.js` - Dashboard component with workspace cards
- IMPLEMENTATION_STATUS.md:352 — `client/workspace-switcher.js` - Header dropdown switcher
- IMPLEMENTATION_STATUS.md:353 — `client/workspace-card.js` - Individual workspace card component (can be in dashboard.js)
- IMPLEMENTATION_STATUS.md:356 — `client/app.js`
- IMPLEMENTATION_STATUS.md:357 — Add workspace tracking (`this.currentWorkspace`, etc.)
- IMPLEMENTATION_STATUS.md:358 — Handle `workspace-info` event
- IMPLEMENTATION_STATUS.md:359 — Handle `workspace-changed` event
- IMPLEMENTATION_STATUS.md:360 — Add `showDashboard()` and `hideD dashboard()` methods
- IMPLEMENTATION_STATUS.md:361 — Initialize Dashboard and WorkspaceSwitcher components
- IMPLEMENTATION_STATUS.md:362 — Update `buildSidebar()` to show workspace-specific info
- IMPLEMENTATION_STATUS.md:364 — `client/index.html`
- IMPLEMENTATION_STATUS.md:365 — Add workspace switcher dropdown to header (before settings button)
- IMPLEMENTATION_STATUS.md:366 — Add dashboard container div (hidden by default)
- IMPLEMENTATION_STATUS.md:367 — Add CSS for dashboard grid and workspace cards
- IMPLEMENTATION_STATUS.md:369 — `client/styles.css`
- IMPLEMENTATION_STATUS.md:370 — Add `.dashboard-container` styles
- IMPLEMENTATION_STATUS.md:371 — Add `.workspace-card` styles with hover effects
- IMPLEMENTATION_STATUS.md:372 — Add `.workspace-switcher` dropdown styles
- IMPLEMENTATION_STATUS.md:373 — Add transition animations for workspace switching
- IMPLEMENTATION_STATUS.md:376 — `server/sessionManager.js`
- IMPLEMENTATION_STATUS.md:377 — Fix `initializeSessions()` to use `this.worktrees` array
- IMPLEMENTATION_STATUS.md:378 — Remove old `worktreeBasePath` and `worktreeCount` references
- IMPLEMENTATION_STATUS.md:379 — Update logging to show workspace name
- IMPLEMENTATION_STATUS.md:381 — `server/index.js`
- IMPLEMENTATION_STATUS.md:382 — Verify workspace handlers are properly added
- IMPLEMENTATION_STATUS.md:383 — Fix build production script path to use workspace config
- IMPLEMENTATION_STATUS.md:384 — Test workspace switching flow
- IMPLEMENTATION_STATUS.md:387 — Run migration script successfully
- IMPLEMENTATION_STATUS.md:388 — Start orchestrator and verify HyFire 2 workspace loads
- IMPLEMENTATION_STATUS.md:389 — Check browser console for `workspace-info` event
- IMPLEMENTATION_STATUS.md:390 — Manually emit `list-workspaces` from console, verify response
- IMPLEMENTATION_STATUS.md:391 — Create a second test workspace config (e.g., book.json)
- IMPLEMENTATION_STATUS.md:392 — Test switching between workspaces via socket event
- IMPLEMENTATION_STATUS.md:393 — Verify sessions reinitialize correctly
- IMPLEMENTATION_STATUS.md:394 — Check logs for errors

### COWORKER_SETUP_GUIDE.md

- Unchecked: 13
- TODO/FIXME: 0

**Unchecked**

- COWORKER_SETUP_GUIDE.md:1043 — **Step 1**: Install Node.js v18+ and Git v2.30+
- COWORKER_SETUP_GUIDE.md:1044 — **Step 2**: Clone AI standards: `git clone https://github.com/web3dev1337/ai-claude-standards ~/.claude`
- COWORKER_SETUP_GUIDE.md:1045 — **Step 3**: Run bootstrap: `cd ~/.claude && bash scripts/bootstrap.sh`
- COWORKER_SETUP_GUIDE.md:1046 — **Step 4**: Create folder structure: `mkdir -p ~/GitHub/{games,tools,web,writing,docs}/...`
- COWORKER_SETUP_GUIDE.md:1047 — **Step 5**: Verify symlinks created: `ls -la ~/GitHub/games/hytopia/CLAUDE.md`
- COWORKER_SETUP_GUIDE.md:1048 — **Step 6**: Clone projects into `PROJECT/master/` folders
- COWORKER_SETUP_GUIDE.md:1049 — **Step 7**: Clone orchestrator to `~/GitHub/tools/automation/claude-orchestrator/`
- COWORKER_SETUP_GUIDE.md:1050 — **Step 8**: Run `npm install` in orchestrator/master
- COWORKER_SETUP_GUIDE.md:1051 — **Step 9**: Run `bash scripts/install-startup.sh`
- COWORKER_SETUP_GUIDE.md:1052 — **Step 10**: Launch orchestrator: `orchestrator` or `npm run dev:all`
- COWORKER_SETUP_GUIDE.md:1053 — **Step 11**: Create first workspace using wizard
- COWORKER_SETUP_GUIDE.md:1054 — **Step 12**: Switch to workspace and verify worktrees auto-create
- COWORKER_SETUP_GUIDE.md:1055 — **Step 13**: Start coding!

### PLANS/2026-01-24/CHECKLIST.md

- Unchecked: 12
- TODO/FIXME: 0

**Unchecked**

- PLANS/2026-01-24/CHECKLIST.md:6 — Running instance in `.../claude-orchestrator/master` is not touched
- PLANS/2026-01-24/CHECKLIST.md:7 — Dev/test ports avoid 3000 (use 4001+ for tests)
- PLANS/2026-01-24/CHECKLIST.md:10 — `npm run test:unit`
- PLANS/2026-01-24/CHECKLIST.md:11 — `npm run test:e2e:safe` (or note why skipped)
- PLANS/2026-01-24/CHECKLIST.md:14 — Dashboard loads
- PLANS/2026-01-24/CHECKLIST.md:15 — Workspaces load and terminals type normally
- PLANS/2026-01-24/CHECKLIST.md:16 — Quick Work modal works
- PLANS/2026-01-24/CHECKLIST.md:17 — PR list works
- PLANS/2026-01-24/CHECKLIST.md:20 — Commit message is scoped and clear
- PLANS/2026-01-24/CHECKLIST.md:21 — Pushed to `origin`
- PLANS/2026-01-24/CHECKLIST.md:22 — PR opened
- PLANS/2026-01-24/CHECKLIST.md:23 — PR URL recorded in rolling log (if applicable)

### PLANS/2026-01-20/CHECKLIST.md

- Unchecked: 11
- TODO/FIXME: 0

**Unchecked**

- PLANS/2026-01-20/CHECKLIST.md:7 — Branch created from updated `main`
- PLANS/2026-01-20/CHECKLIST.md:8 — Issue reproduced and documented (notes in `PLANS/2026-01-20/ROLLING_LOG.md`)
- PLANS/2026-01-20/CHECKLIST.md:9 — Fix implemented with minimal scope
- PLANS/2026-01-20/CHECKLIST.md:10 — Unit tests run: `npm run test:unit`
- PLANS/2026-01-20/CHECKLIST.md:11 — E2E tests run on safe port: `npm run test:e2e:safe` (or justified skip)
- PLANS/2026-01-20/CHECKLIST.md:12 — Manual sanity check (focused, <5 minutes)
- PLANS/2026-01-20/CHECKLIST.md:13 — Docs updated (requirements/plan/log as needed)
- PLANS/2026-01-20/CHECKLIST.md:14 — Commit created (clear message)
- PLANS/2026-01-20/CHECKLIST.md:15 — Pushed to `origin`
- PLANS/2026-01-20/CHECKLIST.md:16 — PR opened (record PR URL in rolling log)
- PLANS/2026-01-20/CHECKLIST.md:17 — PR merged

### DOCUMENTATION.md

- Unchecked: 10
- TODO/FIXME: 0

**Unchecked**

- DOCUMENTATION.md:167 — Enhanced status detection
- DOCUMENTATION.md:168 — Terminal search functionality
- DOCUMENTATION.md:169 — Session logs export
- DOCUMENTATION.md:170 — Performance optimizations
- DOCUMENTATION.md:171 — Mobile-optimized layout
- DOCUMENTATION.md:174 — Task queue system
- DOCUMENTATION.md:175 — Multi-agent coordination
- DOCUMENTATION.md:176 — Automated git operations
- DOCUMENTATION.md:177 — Result comparison
- DOCUMENTATION.md:178 — AI agent communication

### PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md

- Unchecked: 7
- TODO/FIXME: 0

**Unchecked**

- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:91 — `T1+T2` (Tier 1+2 review pressure). If `T1+T2 > 3`: **no Tier 1/2 launches** (review first).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:92 — `T3` and `T4`: respect their own caps (Tier 3 batch + Tier 4 dedicated).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:93 — `WIP` (active projects). If `WIP > WIP_max`: freeze new projects; finish/kill.
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:94 — Pick 1 Tier 1 focus block (90–120 min).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:95 — Pick up to 2 Tier 2 gap fillers (same project if possible).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:96 — Pick Tier 3 batch candidates (non-conflicting, small, safe).
- PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md:97 — Pick at most 1 Tier 4 overnight candidate (tests required).

### SYSTEM_OVERVIEW_PRESENTATION.md

- Unchecked: 7
- TODO/FIXME: 0

**Unchecked**

- SYSTEM_OVERVIEW_PRESENTATION.md:1060 — **AI-Powered Workspace Suggestions**
- SYSTEM_OVERVIEW_PRESENTATION.md:1064 — **Cross-Workspace File Sync**
- SYSTEM_OVERVIEW_PRESENTATION.md:1068 — **Advanced Performance Monitoring**
- SYSTEM_OVERVIEW_PRESENTATION.md:1073 — **Collaborative Features**
- SYSTEM_OVERVIEW_PRESENTATION.md:1080 — **AI Workspace Optimizer**
- SYSTEM_OVERVIEW_PRESENTATION.md:1084 — **Smart Task Distribution**
- SYSTEM_OVERVIEW_PRESENTATION.md:1088 — **Automated Testing Orchestration**

### CLAUDE.md

- Unchecked: 0
- TODO/FIXME: 1

**TODO/FIXME**

- CLAUDE.md:71 — **When you complete ANY feature or fix, you MUST create a pull request using `gh pr create`. This is mandatory. Add "Create PR" as your final todo item to ensure you never forget.**

## Files with no remaining items

These files had 0 unchecked checkboxes and 0 TODO/FIXME tokens under the detection rules above:

- COMPLETE_IMPLEMENTATION.md
- COWORKER_SETUP.md
- IMPLEMENTATION_PLAN.md
- PLANS/2026-01-20/IMPLEMENTATION_PLAN.md
- PLANS/2026-01-20/REQUESTED_CHANGES.md
- PLANS/2026-01-20/ROLLING_LOG.md
- PLANS/2026-01-24/FIZZY_UI_NOTES.md
- PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md
- PLANS/2026-01-24/TASKS_TICKETING.md
- PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md
- PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md
- PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md
- PLANS/2026-01-25/DATA_MODEL.md
- PLANS/2026-01-25/ORCHESTRATOR_NATIVE_DEPENDENCIES_PR.md
- PLANS/2026-01-25/POST_SHIP_ISSUES.md
- PLANS/2026-01-25/PROJECT_RISK_AND_CONFLICTS.md
- PLANS/2026-01-25/PROMPT_ARTIFACTS_PR.md
- PLANS/2026-01-25/QUEUE_REVIEW_INBOX_PR.md
- PLANS/2026-01-25/REMAINING_NEXT_PHASE.md
- PLANS/2026-01-25/REVIEW_CONSOLE_V1.md
- PLANS/2026-01-25/TASK_RECORDS_PR.md
- PLANS/2026-01-25/TIER_FILTERS_PR.md
- PLANS/2026-01-25/TRELLO_PARITY_PR.md
- PLANS/2026-01-25/TRELLO_TASKS_NEXT_PR.md
- PLANS/2026-01-25/WISHLIST_PHASE2.md
- PLANS/2026-01-25/WORKFLOW_MODES_PR.md
- PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md
- PLANS/2026-01-29/REMAINING_WORK_FROM_RECENT_MARKDOWNS.md
- QUICK_START.md
- README.md
- REVISED_WORKSPACE_PLAN.md
- scripts/windows-launchers/README.md
- WORKSPACE_ANALYSIS.md

