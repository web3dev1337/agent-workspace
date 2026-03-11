# Review System Documentation

Complete trace of the **Review Inbox** and **Review Console** features, including all pages, buttons, backend services, data models, socket events, and configuration options.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Review Inbox](#review-inbox)
3. [Review Console](#review-console)
4. [PR Review Automation Pipeline](#pr-review-automation-pipeline)
5. [Data Model (Task Records)](#data-model-task-records)
6. [API Endpoints](#api-endpoints)
7. [Socket.IO Events](#socketio-events)
8. [User Settings & Configuration](#user-settings--configuration)
9. [Terminal Header Review Buttons](#terminal-header-review-buttons)
10. [Diff Viewer Integration](#diff-viewer-integration)
11. [Voice / Command API](#voice--command-api)
12. [CSS & Styling Reference](#css--styling-reference)
13. [File Index](#file-index)

---

## System Overview

```
                          GitHub
                            |
              webhook / polling (60s)
                            |
                +-----------v-----------+
                | prReviewAutomationSvc |  server/prReviewAutomationService.js
                +-----------+-----------+
                            |
            +-------+-------+-------+
            |               |               |
    detect new PRs   spawn reviewers   detect completions
            |               |               |
            v               v               v
     taskRecordService   sessionManager   taskRecordService
     (create pr:* id)   (start agent)    (save review snapshot)
            |               |               |
            +-------+-------+-------+
                            |
                Socket.IO: 'pr-review-automation'
                            |
               +------------v------------+
               |        Client           |
               |                         |
     +---------+---------+     +---------+---------+
     |   Review Inbox    |     |  Review Console   |
     | (Queue w/ preset) |     | (Worktree modal)  |
     +-------------------+     +-------------------+
               |                         |
     +-------------------+     +-------------------+
     | Terminal Headers   |     | Diff Viewer embed |
     | (review buttons)  |     | (iframe)          |
     +-------------------+     +-------------------+
```

**Two consumer surfaces share one backend pipeline:**

| Surface | What it is | Entry point |
|---------|-----------|-------------|
| **Review Inbox** | The Queue panel opened with review-specific filters | Dashboard buttons, command palette, `openReviewInbox()` |
| **Review Console** | A full-screen/docked modal showing terminals + files + commits + embedded diff viewer | `🗂` button on terminal headers, Queue navigation, command palette |

---

## Review Inbox

### What It Is

The Review Inbox is **not a separate page** -- it is the existing **Queue panel** opened with a preset that filters for items needing review. It reuses all Queue infrastructure (filtering, detail panel, navigation) but applies review-specific defaults.

### Entry Points

| Entry | Location | Code |
|-------|----------|------|
| **Dashboard button** "Review Inbox" | `client/dashboard.js:250-260` | `orchestrator.openReviewInbox()` |
| **Dashboard button** "Quick Review" | `client/dashboard.js:250-260` | `orchestrator.openReviewInbox({ quick: true })` |
| **Command palette** `open-queue` | `server/commandRegistry.js` | Emits `commander-action` |
| **Command palette** `open-review-route` | `server/commandRegistry.js` | Opens Queue with T3/T4 + unreviewed + auto-console + auto-next |
| **Keyboard shortcut** | Configurable | Triggers `open-queue` command |

### How It Opens

`client/app.js:3096-3149`

```javascript
openReviewInbox({ quick, project }) {
  const defaults = this.getReviewInboxDefaults(quick ? 'quickReview' : 'reviewInbox');
  this.queuePanelPreset = {
    mode: defaults.mode,           // 'mine' or 'all'
    reviewTier: defaults.tiers,    // 't3t4', 't1', 't2', etc.
    unreviewedOnly: defaults.unreviewedOnly,
    autoConsole: defaults.autoConsole,
    autoAdvance: defaults.autoAdvance,
    reviewActive: true,            // flags Queue as in review mode
    reviewRouteActive: false,
    quickReview: !!quick,
    prioritizeActive: defaults.prioritizeActive,
    project: project || defaults.project
  };
  // Opens the Queue panel with these presets applied
}
```

### Settings That Control It

Stored in `userSettings.global.ui.reviewInbox` and `userSettings.global.ui.quickReview`:

| Setting | Values | Default | Purpose |
|---------|--------|---------|---------|
| `mode` | `mine` \| `all` | `mine` | Show only your PRs or all |
| `tiers` | `t3t4` \| `t1` \| `t2` \| `t3` \| `t4` \| `all` \| `none` | `t3t4` | Filter by agent tier |
| `kind` | `pr` \| `all` | `pr` | Show only PR tasks or all |
| `unreviewedOnly` | boolean | `true` | Hide already-reviewed items |
| `autoConsole` | boolean | `false` | Auto-open Review Console when selecting item |
| `autoAdvance` | boolean | `false` | Jump to next item after review action |
| `prioritizeActive` | boolean | `true` | Sort active agents to top |
| `project` | string | `''` | Filter by `owner/repo` |

### Queue Detail Panel (Review Mode)

When a Queue item is selected and has review data, the detail panel shows:

**Functions in `client/app.js:6550-6734`:**

- `resolvePreferredReviewSourceSession(task)` -- finds the best terminal to paste review into
- `buildLatestReviewMessageForTask(task)` -- formats review text for pasting
- `openLatestReviewForTask(task)` -- opens `latestReviewUrl` in browser/diff-viewer
- `pasteLatestReviewToTaskSession(task)` -- sends review text into resolved terminal

**Detail panel actions:**

| Button | Label | Action |
|--------|-------|--------|
| Open review | Opens `latestReviewUrl` in new tab or diff-viewer |
| Paste to agent | Injects `latestReviewBody` into author's terminal session |
| Inspect | Opens Review Console for the worktree |

### E2E Tests

`tests/e2e/review-workflow.spec.js` -- validates review preset filtering, auto-console, auto-advance.

---

## Review Console

### What It Is

A **modal overlay** (fullscreen or docked) that provides a unified review surface showing:

1. **Terminals** -- agent + server terminals for the worktree (docked into the modal)
2. **Files** -- git changed files in tree or list view (PR files + local uncommitted)
3. **Commits** -- PR commits or local unpushed commits
4. **Diff** -- embedded diff-viewer iframe or link to open externally
5. **Review controls** -- timer, outcome dropdown, notes, merge button, ticket management

Internally called "Worktree Inspector" (`worktree-inspector-modal`), with `review-console-mode` class added when opened for review.

### Entry Points

| Entry | Location | Code |
|-------|----------|------|
| **Terminal header button** `🗂` | Every agent/server terminal header | `openWorktreeInspector(sessionId, { reviewConsole: true })` |
| **Queue navigation** (auto-console) | Queue detail panel | `openReviewConsoleForTask(task)` |
| **Queue "Inspect" button** | Queue detail panel | `openReviewConsoleForPRTask(task)` |
| **Command palette** `open-review-console` | `server/commandRegistry.js` | Accepts `sessionId` or `worktreePath` |
| **Voice command** | `client/app.js:6856-6970` | `open-review-console` with params |

### Button on Terminal Headers

`client/app.js:6348-6360`

```javascript
getWorktreeInspectorButtonHTML(sessionId) {
  // Returns HTML for the 🗂 button
  // title="Review Console (worktree/files/commits/diff)"
  // Visible when visibility.reviewConsole setting is true
}
```

Rendered at `client/app.js:5765, 5772, 6332-6343` in terminal header HTML.

### Core Rendering Function

`openWorktreeInspectorForPath(worktreePath, options)` at `client/app.js:11436-12720` (1,285 lines)

This is the main function that builds the entire Review Console UI. It:

1. **Fetches data** via two API calls:
   - `GET /api/worktree-git-summary` -- files, branch, ahead/behind, commits, PR metadata
   - `GET /api/prs/details` -- PR files with additions/deletions, commits, mergeable status

2. **Renders the header** (single-row unified bar):

   ```
   ┌─────────────────────────────────────────────────────────────────────┐
   │ /path  🌿 branch  PR#123   │ ⛶▐ │ Term|Files|Commits|Diff │ ⏱⏹ │ outcome▾ │ 📝 │ ◀▶ │ ✓Merge │ ✕ │
   │         left                │ win │      section toggles    │     review controls     │ merge  │   │
   └─────────────────────────────────────────────────────────────────────┘
   ```

3. **Renders files section** (tree view or list view):
   - Merges PR files + local uncommitted changes
   - Status badges: `PR`, `Local`, `PR+Local`
   - Stats columns: staged additions/deletions, unstaged additions/deletions
   - Sync button: copy file to another worktree
   - Tree view: folder hierarchy with aggregated stats
   - List view: flat sortable table

4. **Renders commits section**:
   - Shows PR commits if PR exists, else unpushed local commits, else recent commits
   - Up to 50 commits with hash, date, message
   - Warning banner if unpushed commits exist not in PR

5. **Renders diff section**:
   - Toolbar: `⊞ Embed` | `↗ Open` | `⟳ Refresh` | `✕ Close`
   - Starts diff-viewer via `POST /api/diff-viewer/ensure`
   - Polls `GET /api/diff-viewer/status` until running
   - Embeds via iframe at `/pr/{owner}/{repo}/{prNumber}?embed=1`
   - Auto-embeds if `diffEmbed` config is true

6. **Docks terminals** into the modal:
   - Moves agent + server terminal DOM elements from main grid into RC
   - `dockReviewConsoleTerminals()` at line 11220
   - Restores on close via `restoreReviewConsoleDockedTerminals()` at line 11172
   - Agent terminal gets 75% height, server terminal gets 25%

### Layout Grid

```
┌────────────────────────────────────────────────────────┐
│                    RC Header Bar                       │
├──────────────┬─────────────────────────────────────────┤
│              │            Files Section                │
│   Terminals  │  (tree view or list view of changes)    │
│              ├─────────────────────────────────────────┤
│   Agent 75%  │          Commits Section                │
│   Server 25% │  (scrollable commit list)               │
│              ├─────────────────────────────────────────┤
│              │           Diff Section                  │
│              │  (embedded diff-viewer iframe)          │
└──────────────┴─────────────────────────────────────────┘
    30% width                  70% width
```

At `@media (max-width: 1440px)`: 50/50 split.
At `@media (max-width: 1024px)`: single column.

### Presets

Configured via `getReviewConsoleConfig()` at `client/app.js:8965-9014`:

| Preset | Terminals | Files | Commits | Diff | Use case |
|--------|-----------|-------|---------|------|----------|
| `default` | Yes | Yes | Yes | Yes | Full view |
| `review` | Yes | No | No | Yes | Diff-dominant review |
| `throughput` | Yes | No | No | Yes | Batch review (default) |
| `deep` | Yes | Yes | Yes | Yes | Deep code review |
| `code` | No | Yes | Yes | Yes | Code-focused, no terminals |
| `terminals` | Yes | No | No | No | Terminal-only |
| `custom` | User-toggled | | | | Manual toggle |

### Review Controls (in header)

| Control | Function | Persistence |
|---------|----------|-------------|
| ⏱ Start | Sets `reviewStartedAt` on task record | `PUT /api/process/task-records/{id}` |
| ⏹ Stop | Sets `reviewEndedAt` on task record | `PUT /api/process/task-records/{id}` |
| Outcome dropdown | `approved` \| `needs_fix` \| `commented` \| `skipped` | `PUT /api/process/task-records/{id}` |
| 📝 Notes | Textarea, auto-saves on blur | `PUT /api/process/task-records/{id}` |
| ◀ Prev | Navigate to previous Queue item | `queuePanelApi.prev()` |
| ▶ Next | Navigate to next Queue item | `queuePanelApi.next()` |
| ✓ Merge | Merge PR via API | `POST /api/prs/merge { url, method: 'merge' }` |

Merge button only visible when PR is open, not draft, and mergeable.

### Ticket Management

Lines 12384-12564. Button: `📋 Move`.

1. Fetches Trello card via `/api/tasks/cards/{cardId}`
2. Fetches board lists via `/api/tasks/boards/{boardId}/lists`
3. Shows dropdown prioritized by tags: Current (0) > Done/For Test (1) > Other (2)
4. POSTs to `/api/process/task-records/{taskId}/ticket-move` with `{ listId }`

### Window Modes

| Mode | Class | Size |
|------|-------|------|
| Fullscreen | `.worktree-inspector-modal.fullscreen` | 95% viewport |
| Docked | `.worktree-inspector-modal.docked` | 30% of screen (right side) |

Toggle via `⛶` / `▐` buttons or `review-console-set-window` command.

### Modal Lifecycle

```javascript
// Create
ensureWorktreeInspectorModal()  // line 11125
// div#worktree-inspector-modal.modal.hidden.worktree-inspector-modal

// Open
openWorktreeInspectorForPath()  // line 11436
// removes 'hidden', adds 'review-console-mode', docks terminals

// Close
closeWorktreeInspector()  // line 11170
// restores terminals to main grid, adds 'hidden', cleans up hotkeys
```

---

## PR Review Automation Pipeline

**Service:** `server/prReviewAutomationService.js` (636 lines)

### Lifecycle

```
1. DETECTION
   ├── Polling: poll() every 60s checks GitHub for open PRs
   └── Webhook: POST /api/github/webhook (pull_request.opened/ready_for_review)
        └── onPrCreated()
                │
2. TRACKING
   └── Creates task record: pr:owner/repo#123
       ├── tier, ticketProvider, ticketCardId, etc.
       └── Emits: pr-review-automation { event: 'new-pr-tracked' }
                │
3. REVIEWER SPAWNING (if autoSpawnReviewer = true)
   └── _spawnReviewerForPr()
       ├── Finds available worktree from active workspace
       ├── Starts Claude/Codex session
       ├── Waits 8-15s for agent init
       ├── Sends structured review prompt (gh pr diff, gh pr view)
       ├── Tracks in activeReviewers map
       ├── Updates task record: reviewerSpawnedAt, reviewerSessionId
       └── Emits: pr-review-automation { event: 'reviewer-spawned' }
                │
4. REVIEW COMPLETION
   └── _findCompletedReviews() (polling)
       or onReviewSubmitted() (webhook)
       ├── Maps GitHub state: APPROVED→approved, CHANGES_REQUESTED→needs_fix
       ├── Saves snapshot: latestReviewBody, latestReviewSummary, latestReviewUrl
       └── Emits: pr-review-automation { event: 'review-completed' }
                │
5. FEEDBACK DELIVERY
   └── _sendFeedbackToAuthor()
       ├── Finds source session via reviewSourceSessionId
       ├── Builds feedback message with _buildReviewFeedbackMessage()
       ├── Delivery action: notify | paste | paste_and_notify | none
       ├── Updates: latestReviewDeliveredAt
       └── Shows toast + system notification per settings
```

### Feedback Message Format

```
--- PR Review Update ---
PR #<number> reviewed by <user>.
Outcome: APPROVED|CHANGES REQUESTED|COMMENTED
Reviewer agent: claude|codex
GitHub: <url>

Summary:
<truncated_review_text>

<contextual_message_based_on_outcome>
--- End PR Review Update ---
```

### Config (`userSettings.global.ui.tasks.automations.prReview`)

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `enabled` | boolean | false | Master enable |
| `pollEnabled` | boolean | true | Enable polling cycle |
| `pollMs` | number | 60000 | Polling interval (ms) |
| `webhookEnabled` | boolean | false | Accept GitHub webhooks |
| `reviewerAgent` | string | `'claude'` | `'claude'` or `'codex'` |
| `reviewerTier` | number | 4 | Tier for reviewer agents |
| `autoSpawnReviewer` | boolean | true | Auto-launch reviewer agent |
| `autoFeedbackToAuthor` | boolean | true | Auto-deliver feedback |
| `autoSpawnFixer` | boolean | false | Auto-spawn fixer on needs_fix |
| `notifyOnReviewerSpawn` | boolean | true | Toast when reviewer starts |
| `notifyOnReviewCompleted` | boolean | true | Toast when review done |
| `approvedDeliveryAction` | string | `'notify'` | Action for approved reviews |
| `commentedDeliveryAction` | string | `'notify'` | Action for comment reviews |
| `needsFixFeedbackAction` | string | `'paste_and_notify'` | Action for needs_fix reviews |
| `maxConcurrentReviewers` | number | 3 | Max simultaneous review agents |
| `repos` | string[] | `[]` | Repos to monitor (empty = all) |

---

## Data Model (Task Records)

**Service:** `server/taskRecordService.js` (835 lines)

Task records are the central persistence layer. PR-related records use ID format `pr:owner/repo#number`.

### Review-Specific Fields

| Field | Type | Set By | Purpose |
|-------|------|--------|---------|
| `reviewed` | boolean | Queue/RC | Has this been manually reviewed? |
| `reviewedAt` | ISO string | Queue/RC | When manual review happened |
| `reviewOutcome` | string | RC/automation | `'approved'` \| `'needs_fix'` \| `'commented'` \| `'skipped'` \| `null` |
| `reviewStartedAt` | ISO string | RC timer | When reviewer started |
| `reviewEndedAt` | ISO string | RC timer | When reviewer stopped |
| `latestReviewSummary` | string | Automation | Truncated review (4KB, 8 lines max) |
| `latestReviewBody` | string | Automation | Full review text (20KB max) |
| `latestReviewOutcome` | string | Automation | GitHub review state mapped |
| `latestReviewUser` | string | Automation | GitHub username of reviewer |
| `latestReviewUrl` | string | Automation | GitHub review URL |
| `latestReviewSubmittedAt` | ISO string | Automation | When submitted on GitHub |
| `latestReviewAgent` | string | Automation | `'claude'` or `'codex'` |
| `latestReviewDeliveredAt` | ISO string | Automation | When pasted to source session |
| `reviewSourceSessionId` | string | Auto-linking | Terminal that authored the PR |
| `reviewSourceWorktreeId` | string | Auto-linking | Worktree that authored the PR |
| `reviewerSessionId` | string | Spawning | Which session did the review |
| `reviewerWorktreeId` | string | Spawning | Which worktree the reviewer used |
| `reviewerSpawnedAt` | ISO string | Spawning | When reviewer agent launched |

### Persistence

- In-memory: `Map<string, object>` in taskRecordService
- On-disk: `~/.orchestrator/task-records.json`
- Repo-persisted (optional): promoted via `POST /api/process/task-records/:id/promote`

---

## API Endpoints

### PR Review Automation

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| `POST` | `/api/process/automations/pr-review/run` | Manually trigger polling cycle | `server/index.js:3724` |
| `GET` | `/api/process/automations/pr-review/status` | Get automation status | `server/index.js:3737` |
| `PUT` | `/api/process/automations/pr-review/config` | Update automation config | `server/index.js:3748` |

### PR Operations

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| `POST` | `/api/prs/review` | Submit review to a PR (action: approve/request_changes/comment) | `server/index.js:5164` |
| `POST` | `/api/prs/merge` | Merge a PR | `server/index.js:5143` |
| `GET` | `/api/prs/details` | Get PR files, commits, mergeable status | `server/index.js:5185` |

### Task Records

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| `GET` | `/api/process/task-records` | List all task records | `server/index.js:5816` |
| `GET` | `/api/process/task-records/:id` | Get single record | `server/index.js:5840` |
| `PUT` | `/api/process/task-records/:id` | Upsert fields (review metadata) | `server/index.js:5860` |
| `POST` | `/api/process/task-records/:id/promote` | Promote to repo-persisted | `server/index.js:5895` |
| `POST` | `/api/process/task-records/:id/ticket-move` | Move linked Trello card | `server/index.js:~12550` |

### Worktree / Git Data

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| `GET` | `/api/worktree-git-summary` | Git status, files, commits, PR for a worktree | `server/index.js:5015` |

### Diff Viewer

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/diff-viewer/ensure` | Start diff-viewer service |
| `GET` | `/api/diff-viewer/status` | Check if diff-viewer is running |

### GitHub Webhooks

| Method | Path | Purpose | Lines |
|--------|------|---------|-------|
| `POST` | `/api/github/webhook` | Receive GitHub webhook events | `server/index.js:3606` |

---

## Socket.IO Events

### `pr-review-automation` (server -> client)

Emitted by `prReviewAutomationService._emitUpdate()`.

| Event Subtype | Payload | When |
|---------------|---------|------|
| `new-pr-tracked` | `{ event, prId, at }` | New PR detected and task record created |
| `reviewer-spawned` | `{ event, prId, worktreeId, sessionId, at }` | Reviewer agent launched |
| `review-completed` | `{ event, prId, outcome, reviewUser, reviewUrl, recordPatch, reviewSummary, pastedToSessionId, deliveryAction, at }` | GitHub review detected |

**Client handler:** `client/app.js:1154` -> `handlePrReviewAutomationEvent(payload)` (lines 6780-6950)

Actions on receive:
1. Updates task record in memory
2. Refreshes Queue panel if open
3. Shows toast notification (per settings)
4. Triggers system notification (per settings)
5. Updates terminal header review buttons

---

## User Settings & Configuration

### Settings Panel HTML

`client/index.html:352-460`

#### Review Console Section (lines 352-396)

| Control ID | Type | Purpose |
|------------|------|---------|
| `#review-console-preset` | select | Layout preset (review/throughput/default/deep/terminals/code) |
| `#review-console-fullscreen` | checkbox | Open fullscreen by default |
| `#review-console-diff-embed` | checkbox | Embed diff by default |
| `#review-console-show-agent` | checkbox | Show agent terminals |
| `#review-console-show-server` | checkbox | Show server terminals |

#### Review Inbox Section (lines 400-430)

| Control ID | Type | Purpose |
|------------|------|---------|
| `#review-inbox-mode` | select | mine/all |
| `#review-inbox-tiers` | select | t3t4/t1/t2/t3/t4/all/none |
| `#review-inbox-pr-only` | checkbox | PRs only filter |
| `#review-inbox-unreviewed` | checkbox | Unreviewed only |
| `#review-inbox-prioritize-active` | checkbox | Sort active agents first |
| `#review-inbox-auto-console` | checkbox | Auto-open Review Console |
| `#review-inbox-auto-advance` | checkbox | Auto-advance after review |
| `#review-inbox-project` | text | Default project filter |

#### PR Review Automation Section (lines 430-460)

| Control ID | Type | Purpose |
|------------|------|---------|
| `#pr-review-auto-enabled` | checkbox | Enable automation |
| `#pr-review-reviewer-agent` | select | claude/codex |
| `#pr-review-reviewer-mode` | select | fresh/continue |
| `#pr-review-notify-started` | checkbox | Notify when reviewer spawns |
| `#pr-review-notify-completed` | checkbox | Notify when review done |
| `#pr-review-approved-action` | select | Delivery action for approved |
| `#pr-review-commented-action` | select | Delivery action for comments |
| `#pr-review-needs-fix-action` | select | Delivery action for needs_fix |

### Settings Persistence

- `client/app.js:2413-2461` -- change listeners that save to server
- `client/app.js:16684-16717` -- loads saved settings into UI on panel open
- Server stores in user-settings JSON file

---

## Terminal Header Review Buttons

**Function:** `getPrReviewButtons(sessionId)` at `client/app.js:3666-3719`

Three buttons appear on terminal headers when a session is linked to a PR with review data:

| Button | Glyph | CSS Class | Condition | Click Action |
|--------|-------|-----------|-----------|-------------|
| Pending | ⏳ | `.pr-review-status-btn.pending` | Review in progress, no result yet | Disabled |
| Open review | 📝 | `.pr-review-status-btn.ready` | `latestReviewUrl` exists | Opens review URL in browser/diff-viewer |
| Paste review | ↩ | `.pr-review-paste-btn` | `latestReviewBody` exists | Injects review text into terminal |

### How Sessions Get Linked to PRs

**Function:** `maybeLinkPrTaskToSession(sessionId, prUrl)` at `client/app.js:3579-3622`

Triggers:
1. Session restored from continuity (`client/app.js:1208`)
2. New session created with existing PR URL (`client/app.js:6074`)
3. Manual branch detection (`client/app.js:6117`)

Sets on the `pr:owner/repo#number` task record:
- `reviewSourceSessionId` -- the terminal that wrote the code
- `reviewSourceWorktreeId` -- the worktree it lives in

### Related Functions

| Function | Line | Purpose |
|----------|------|---------|
| `updateTerminalControlsForPrTask(prTaskId)` | 3650 | Refreshes header buttons for all linked sessions |
| `openLatestReviewForSession(sessionId)` | ~3680 | Opens `latestReviewUrl` |
| `pasteLatestReviewToSessionFromHeader(sessionId)` | ~3690 | Pastes `latestReviewBody` into terminal |

---

## Diff Viewer Integration

### Architecture

The diff-viewer is a **separate service** (`diff-viewer/` directory) with its own Express server. The main orchestrator manages its lifecycle.

### How Review Console Embeds It

1. `POST /api/diff-viewer/ensure` -- starts the diff-viewer process if not running
2. Polls `GET /api/diff-viewer/status` until status is `running`
3. Constructs URL: `http://localhost:{DIFF_VIEWER_PORT}/pr/{owner}/{repo}/{prNumber}?embed=1`
4. Creates iframe in `.rc-diff-section` with that URL

### Review State Tracking (in diff-viewer)

`diff-viewer/server/api/review.js` (174 lines)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/review/state/:owner/:repo/:pr` | Overall review progress |
| `GET /api/review/state/:owner/:repo/:pr/file?path=` | Single file review state |
| `POST /api/review/state/:owner/:repo/:pr/file` | Mark file as reviewed |
| `POST /api/review/state/:owner/:repo/:pr/batch` | Batch mark/unmark files |

Uses in-memory cache tracking which files have been reviewed within a session.

---

## Voice / Command API

Registered in `server/commandRegistry.js` and handled in `client/app.js:6856-6970`.

| Command | Parameters | Effect |
|---------|-----------|--------|
| `open-review-console` | `sessionId` or `worktreePath`, optional `label` | Opens Review Console for target |
| `close-review-console` | none | Closes Review Console |
| `review-console-set-preset` | `preset`: string | Switches layout preset |
| `review-console-set-window` | `mode`: `'fullscreen'` or `'docked'` | Toggles window mode |
| `review-console-toggle-section` | `section`: `'terminals'` \| `'files'` \| `'commits'` \| `'diff'` | Toggles section |
| `review-console-files-view` | `view`: `'tree'` or `'list'` | Switches files display |
| `review-console-diff-open` | none | Opens diff in new tab |
| `review-console-diff-embed` | `enabled`: boolean | Shows/hides embedded diff |
| `open-queue` | none | Opens Queue panel |
| `open-review-route` | none | Opens Queue with review presets (T3/T4, unreviewed, auto-console, auto-next) |
| `queue-next` | none | Navigate to next Queue item |
| `queue-blockers` | none | Show blocked items |
| `queue-triage` | none | Open triage view |

All emit Socket.IO `commander-action` events.

---

## CSS & Styling Reference

`client/styles.css`

### Review Console Modal

| Selector | Lines | Purpose |
|----------|-------|---------|
| `.worktree-inspector-modal` | 2346-2415 | Base modal (overlay, z-index, bg) |
| `.worktree-inspector-modal.docked` | 2355-2373 | 30% width, right-aligned |
| `.worktree-inspector-modal.fullscreen` | 2375-2394 | 95% viewport |
| `.worktree-inspector-modal.review-console-mode` | 2413 | Hides default modal header |

### Review Console Layout

| Selector | Lines | Purpose |
|----------|-------|---------|
| `.rc-header` | 3320-3431 | Unified single-row header bar |
| `.rc-header-left` | 3334-3369 | Path, branch, PR link |
| `.rc-header-toggles` | 3371-3383 | Window mode + section toggles |
| `.rc-header-right` | 3385-3430 | Review timer, outcome, merge |
| `.rc-main-grid` | 3150-3168 | 2-column grid (30/70) |
| `.rc-left-col` | 3171-3210 | Terminals column |
| `.rc-right-col` | 3213-3317 | Files + commits + diff column |
| `.rc-commits-section` | 3222-3266 | Collapsible commits list |
| `.rc-diff-section` | 3269-3317 | Diff viewer area |
| `.rc-diff-iframe` | 3300-3312 | Embedded diff viewer iframe |
| `.rc-tiny-btn` | 3125-3147 | Small toggle button |
| `.rc-outcome-select` | 3393-3402 | Outcome dropdown |
| `.rc-merge-btn` | 3404-3430 | Merge PR button (green) |

### Terminal Header Buttons

| Selector | Lines | Purpose |
|----------|-------|---------|
| `.control-btn.pr-review-status-btn.pending` | 6037-6042 | ⏳ hourglass, warning color |
| `.control-btn.pr-review-status-btn.ready` | 6043-6048 | 📝 document, primary color |
| `.control-btn.pr-review-paste-btn` | 6049-6055 | ↩ return arrow, primary color |

---

## File Index

Every file that participates in the review system:

### Server

| File | Lines | Role |
|------|-------|------|
| `server/prReviewAutomationService.js` | All (636) | PR review automation: polling, spawning, completion, feedback |
| `server/taskRecordService.js` | 372-395 | Review field definitions and persistence |
| `server/pullRequestService.js` | All | GitHub PR operations (fetch, review, merge) |
| `server/gitHelper.js` | 351-379 | PR URL detection, caching |
| `server/index.js` | 3606-3670 | GitHub webhook handler |
| `server/index.js` | 3724-3754 | PR review automation API endpoints |
| `server/index.js` | 5015-5037 | Worktree git summary endpoint |
| `server/index.js` | 5143-5208 | PR review/merge/details endpoints |
| `server/index.js` | 5816-5908 | Task record CRUD endpoints |
| `server/commandRegistry.js` | 614-634+ | Command palette entries for review/queue |

### Client

| File | Lines | Role |
|------|-------|------|
| `client/app.js` | 1154 | Socket.IO listener for `pr-review-automation` |
| `client/app.js` | 2413-2461 | Settings change listeners |
| `client/app.js` | 3096-3149 | `openReviewInbox()` / `getReviewInboxDefaults()` |
| `client/app.js` | 3579-3719 | PR auto-linking + terminal header buttons |
| `client/app.js` | 5765, 5772 | Terminal header button rendering |
| `client/app.js` | 6332-6360 | `getWorktreeInspectorButtonHTML()` |
| `client/app.js` | 6550-6734 | Queue detail panel review actions |
| `client/app.js` | 6780-6950 | `handlePrReviewAutomationEvent()` |
| `client/app.js` | 6856-6970 | Voice/command handlers for RC |
| `client/app.js` | 8965-9014 | `getReviewConsoleConfig()` + presets |
| `client/app.js` | 11125-11170 | Modal creation/close |
| `client/app.js` | 11172-11220 | Terminal dock/restore |
| `client/app.js` | 11411-11434 | `openWorktreeInspector()` |
| `client/app.js` | 11436-12720 | `openWorktreeInspectorForPath()` (core render) |
| `client/app.js` | 12722-12797 | `openReviewConsoleForTask()` / `ForPRTask()` |
| `client/app.js` | 16684-16717 | Load settings into UI |
| `client/dashboard.js` | 250-260, 3631-3643 | Dashboard review buttons |
| `client/index.html` | 352-460 | Settings panel HTML |
| `client/styles.css` | 2346-2415 | Modal styling |
| `client/styles.css` | 3125-3430 | RC layout + header styling |
| `client/styles.css` | 6037-6055 | Terminal header review buttons |

### Diff Viewer

| File | Lines | Role |
|------|-------|------|
| `diff-viewer/server/api/review.js` | All (174) | File-level review state tracking |
| `diff-viewer/server/index.js` | - | Diff viewer server entry |

### Config

| File | Lines | Role |
|------|-------|------|
| `user-settings.default.json` | 178-197 | Default review settings |

### Tests

| File | Role |
|------|------|
| `tests/e2e/review-workflow.spec.js` | E2E tests for review inbox filtering |

### Docs / Plans

| File | Role |
|------|------|
| `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md` | Original feature spec/roadmap |
| `CODEBASE_DOCUMENTATION.md` | System-level documentation |

---

## Recent Commits (March 2026)

| SHA | Message | What Changed |
|-----|---------|-------------|
| `55e1551` | feat: surface saved PR reviews in terminal headers | Added ⏳📝↩ buttons to terminal headers |
| `9a4113c` | feat: auto-link detected PRs to source sessions | `maybeLinkPrTaskToSession()`, bidirectional linking |
| `b13a4f1` | feat: persist and route PR review feedback | Review snapshot fields, delivery actions, terminal injection |
| `4f1cf8a` | fix: restore app bootstrap syntax | Bootstrap fix |
| `72e9536` | fix: harden pr review agent launch | Agent launch reliability |
