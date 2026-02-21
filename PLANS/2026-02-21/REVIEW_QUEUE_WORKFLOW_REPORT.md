# Review + Queue + PR + Diff + Workflow System Report

Date: 2026-02-21

Scope: Full inventory of review-related UI, workflows, panels, APIs, data models, and automation across the Claude Orchestrator codebase. Includes duplicates/overlaps and all entry points (UI, command palette, voice, notifications, dashboard, terminal controls).

Sources scanned: `client/`, `server/`, `diff-viewer/` (key files listed per section).

## UI Entry Points (All Ways Users Can Open or Trigger Review/Queue/PR/Diff)

Header buttons in `client/index.html` + wired in `client/app.js`:
- Queue (`#queue-btn`) opens Queue panel.
- PRs (`#prs-btn`) opens PRs panel.
- Review Route (`#review-route-btn`) opens Review Route (Queue preset + Review Console).
- Diff (`#diff-viewer-open`) opens Advanced Diff Viewer.
- Activity (`#activity-btn`) opens Activity feed panel.
- Workflow mode buttons (`#workflow-focus`, `#workflow-review`, `#workflow-background`, `#workflow-all`) switch workflow filtering.
- Tier filters (`#tier-filter-*`) filter by tier.
- Process banner (`#process-banner`) is a WIP/queue status chip that opens Queue when clicked.

Dashboard entry points in `client/dashboard.js`:
- Process banner (`#dashboard-process-banner`) opens Queue.
- Process cards include buttons to open Queue, Queue Viz, PRs.
- Discord queue buttons (ensure/process) are in the Discord summary card.

Terminal header controls in `client/app.js`:
- Review Console button (worktree inspector) opens the review console for that session/worktree.
- GitHub buttons include View PR, View Branch Diff, Advanced Diff, Advanced Branch Diff (if enabled).

Sidebar entry points in `client/app.js`:
- Ready for review toggle (mark/clear) creates or clears worktree review tags.
- Refresh branch label button (if enabled) refreshes branch display.
- Session visibility toggles affect which terminals appear in review/workflow views.

Notifications in `client/notifications.js`:
- Notification actions can open Queue and Diff Viewer.

Command palette + Commander in `server/commandRegistry.js` and `client/commander-panel.js`:
- `open-queue`, `open-prs`, `open-activity`, `open-review-route`, `open-review-console`, `open-diff-viewer`.
- Many `queue-*` commands for review operations (see Command/Voice section).

Voice commands in `server/voiceCommandService.js`:
- Voice triggers map to the same command registry actions (queue, review route, review console, diff viewer, PRs, activity).

## Primary Panels / Pages (UI Surfaces)

Queue Panel in `client/app.js` (`showQueuePanel`):
- Unified review inbox across PRs, worktrees, and sessions.
- Filters: mode (mine/all), tier, triage, unreviewed, blocked.
- Review flows: Conveyor T2, Conveyor T3, Review Route, Start Review.
- Automation toggles: Auto Diff, Auto Console, Auto Next, Auto Reviewer, Auto Fixer, Auto Recheck.
- Navigation: Prev/Next, search, refresh, pairing recommendations.
- Dependency graph, conflict detection, and snooze mechanics.

PRs Panel in `client/app.js` (`showPRsPanel`):
- Lists PRs via `/api/prs` with filters for mode, state, sort, repo, owner, query.
- Includes Open + Diff buttons per PR (Diff opens Advanced Diff Viewer).

Review Console / Worktree Inspector in `client/app.js`:
- Review console layout with terminals, files, commits, conversation, diff viewer.
- Review presets and layout controls (review vs throughput, fullscreen, diff embed).
- Review Route bar (tier/risk/blocked/unreviewed filters) inside the console.

Activity Feed in `client/activity-feed.js`:
- Shows activity events including PR merges/reviews, builds, tests, session actions.
- Can open focus/queue related actions depending on event type.

Advanced Diff Viewer in `diff-viewer/` + `server/diffViewerService.js`:
- Standalone diff viewer service; can be opened or embedded in Review Console.
- Client integration in `client/app.js` via `launchDiffViewer`.

## Workflow Modes + Review Flows

Workflow modes in `client/app.js`:
- Focus, Review, Background, All (header buttons and keyboard shortcuts).
- Workflow mode controls filtering of visible terminals and queue presets.
- Settings stored under `ui.workflow` (see `user-settings.default.json`).

Review Route flow in `client/app.js`:
- A Queue preset that targets Tier 3/4, unreviewed items, auto-console + auto-next.
- Entry points: header Review Route, queue “Review Route” button, Projects/Chats panel button, scheduler template.

Conveyor flows in Queue in `client/app.js`:
- Conveyor T2: Tier 2 + unreviewed + auto diff + auto next.
- Conveyor T3: Tier 3 + unreviewed + auto console + auto next.

Queue pairing flow in `client/app.js`:
- Pairing suggestions from `/api/process/pairing` (Tier 2/3).

Queue dependency/conflict flows in `client/app.js`:
- Dependency graph via `/api/process/dependencies` (from task dependency service).
- Conflict scanning via worktree conflict service endpoints.

## Data Model + Review Metadata

Process tasks (Queue input) in `server/processTaskService.js`:
- PR tasks from `pullRequestService` (GitHub via `gh`).
- Ready-for-review worktrees from `worktreeTagService`.
- Waiting sessions from `sessionManager`.
- Combined list sorted by `updatedAt`.

Task metadata in `server/taskRecordService.js`:
- Tier, risk, review outcomes, reviewed timestamps, notes, verify minutes, pFail.
- Used by Queue sorting, triage, and workflow decisions.

Ready-for-review tags in `server/worktreeTagService.js`:
- Stored in `~/.orchestrator/worktree-tags.json`.
- Used to create Queue “worktree” tasks.

PR data in `server/pullRequestService.js`:
- `gh` backed PR list + details.
- Used by PRs panel and Queue PR tasks.

PR review automation in `server/prReviewAutomationService.js`:
- Polling + auto spawn reviewer agents + review completion tracking.

## Server APIs (Review/Queue/PR/Diff/Workflow)

Queue + review APIs in `server/index.js`:
- `GET /api/process/tasks` (Queue source).
- `GET /api/process/status` (WIP/queue banner summary).
- `GET /api/process/pairing` (pairing suggestions).
- `GET /api/process/task-records` and `PUT /api/process/task-records/:id` (review metadata).
- `GET /api/process/distribution` (used by dashboard / routing views).
- `GET /api/process/advice`, `GET /api/process/projects`, `GET /api/process/readiness/templates` (dashboard and workflow context).

PR APIs in `server/index.js`:
- `GET /api/prs` (PRs panel list).
- `GET /api/prs/details` (PR detail data).
- `POST /api/prs/merge` and `POST /api/prs/review` (review actions).

Review automation APIs in `server/index.js`:
- `GET /api/process/automations/pr-review/status` and `PUT /api/process/automations/pr-review/config`.
- `POST /api/process/automations/pr-review/run`.

Diff Viewer APIs in `server/index.js`:
- `GET /api/diff-viewer/status`.
- `POST /api/diff-viewer/ensure`.

Worktree review tags in `server/index.js`:
- `GET /api/worktree-tags`.
- `POST /api/worktree-tags/ready`.

## Command Palette + Commander + Voice (All Review/Queue Actions)

Command registry in `server/commandRegistry.js`:
- Open actions: `open-queue`, `open-prs`, `open-activity`, `open-review-route`, `open-review-console`, `open-diff-viewer`.
- Queue actions: `queue-next`, `queue-prev`, `queue-triage`, `queue-blockers`, `queue-conveyor-t2`, `queue-conveyor-t3`, `queue-review-timer-start`, `queue-review-timer-stop`.
- Queue item actions: `queue-claim`, `queue-release`, `queue-assign`, `queue-unassign`, `queue-set-tier`, `queue-set-risk`, `queue-set-outcome`, `queue-set-notes`, `queue-set-ticket`, `queue-set-prompt-ref`.
- Queue automation: `queue-spawn-reviewer`, `queue-spawn-fixer`, `queue-spawn-recheck`, `queue-spawn-overnight`.
- Queue navigation: `queue-select`, `queue-select-by-pr-url`, `queue-select-by-pr-ref`, `queue-select-by-ticket`.
- Dependencies/conflicts: `queue-deps-add`, `queue-deps-remove`, `queue-deps-graph`, `queue-conflicts-refresh`.
- PR actions: `queue-approve`, `queue-request-changes`, `queue-merge`.

Voice commands in `server/voiceCommandService.js` map to the same command names (Queue, Review Route, PRs, Activity, Diff).

## LocalStorage + Client Settings (Review/Queue State)

Queue panel state in `client/app.js`:
- `queue-auto-console`, `queue-auto-advance`, `queue-auto-reviewer`, `queue-auto-fixer`, `queue-auto-recheck`.
- `queue-triage`, `queue-blocked-only`.
- `queue-dep-graph-depth`, `queue-dep-graph-view`, `queue-dep-graph-show-satisfied`, `queue-dep-graph-pins`.
- `queue-snoozes`, `queue-snooze-counts`.

Review console state in `client/app.js`:
- `review-console-collapsed-panels` (which sections are hidden).
- `review-console-route-filters` (review route bar filters).

PRs panel state in `client/app.js`:
- `prs-panel-mode`, `prs-panel-state`, `prs-panel-sort`, `prs-panel-repo`, `prs-panel-owner`.

Workflow settings in `user-settings.default.json` + `server/userSettingsService.js`:
- `ui.workflow.mode`, `ui.workflow.focus.*`, `ui.workflow.notifications.*`.

## Duplicates / Overlaps (Where the Same Thing Appears Multiple Times)

Queue access duplicates:
- Header Queue button, dashboard Queue button, process banner click, notifications actions, command palette, voice commands.

PRs access duplicates:
- Header PRs button, dashboard PRs card, Projects/Chats panel shortcut, command palette, voice commands.

Review Route access duplicates:
- Header Review Route, Queue “Review Route” button, Projects/Chats panel shortcut, scheduler template, command palette, voice commands.

Diff viewer access duplicates:
- Header Diff button, PRs panel “Diff” button, Queue detail “Open Diff” action, Review Console embedded diff, terminal GitHub advanced diff buttons, command palette, voice commands.

Review Console access duplicates:
- Terminal review console button, Queue auto-console, Review Route auto-console, command palette.

Ready-for-review duplicates:
- Sidebar “mark ready” toggle, Queue worktree task entry, process status counts.

## What’s Hidden by Default (Visibility Flags)

Visibility flags are in `ui.visibility` in `user-settings.default.json` and merged in `server/userSettingsService.js`. Defaults relevant to review/queue/PR/diff are:
- Header buttons hidden: PRs, Queue, Review Route, Activity, Diff, Workflow mode buttons, Workflow Background.
- Process banner hidden (WIP + BWQX queue chip).
- Terminal buttons hidden: Advanced Diff, Advanced Branch Diff, View Branch on GitHub, Refresh, Interrupt, Build Zip, Start Claude with settings, Create New Project.
- Intent hints hidden and API calls disabled.
- Sidebar hidden: ready-for-review button, branch refresh, session visibility toggles.
- Dashboard hidden: process cards (status/telemetry/polecats/discord/projects/advice/readiness).

## Differences That Can Be Confusing (Clarified)

Close terminal process vs Remove worktree:
- Close terminal process kills only the agent/server process but keeps the worktree in the workspace.
- Remove worktree deletes the worktree entry from workspace config and closes all related terminals (files on disk are kept).

Review Route vs Review Console vs Queue:
- Queue is the list of items to review.
- Review Route is a Queue preset and automation flow.
- Review Console is the actual review UI for a selected PR/worktree/session.

Advanced Diff Viewer vs GitHub Diff:
- GitHub Diff opens in GitHub compare/PR views.
- Advanced Diff Viewer is a local service providing richer diff tooling and embeds into Review Console.

## Key Files (Fast Lookup)

Client:
- `client/app.js` (Queue, PRs panel, Review Console, Diff Viewer integration, workflow mode)
- `client/index.html` (header buttons and workflow controls)
- `client/dashboard.js` (dashboard queue/PR entry points)
- `client/activity-feed.js` (activity UI)
- `client/notifications.js` (queue/diff actions)

Server:
- `server/index.js` (all process/PR/diff APIs)
- `server/processTaskService.js` (Queue data)
- `server/taskRecordService.js` (review metadata)
- `server/processStatusService.js` (WIP/queue banner data)
- `server/pullRequestService.js` (PR data via gh)
- `server/prReviewAutomationService.js` (review automation)
- `server/worktreeTagService.js` (ready-for-review tags)
- `server/commandRegistry.js` (command palette/commander actions)
- `server/voiceCommandService.js` (voice triggers)
- `server/schedulerService.js` (review-route scheduler templates)

Diff Viewer:
- `server/diffViewerService.js`
- `diff-viewer/`
