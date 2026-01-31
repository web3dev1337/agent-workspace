# Full UI control via Commands (Voice + Commander) — Gap analysis

Date: 2026-01-31  
Owner intent: “Do *everything* the UI can do” via (a) voice commands, and (b) typing to **Commander Claude** — both routed through the same shared command surface, and extensible to future providers (e.g. “Open Code”).

This doc is **implementation-oriented**: it enumerates the missing pieces, proposes a minimal architecture that stays in sync automatically, and breaks work into PR-sized tasks.

---

## Ground truth / current state (already shipped)

### Shared command surface (exists)
- Server-side semantic command registry: `server/commandRegistry.js`
  - Discovery: `GET /api/commander/capabilities` (driven by the registry)
  - Execution: `POST /api/commander/execute` → `commandRegistry.execute(...)`
- Voice pipeline: `server/voiceCommandService.js`
  - Rule-based parse first, then LLM fallback (Ollama/Claude)
  - LLM prompt already includes `commandRegistry.getCapabilities()`, so the *LLM path* stays automatically up to date as commands are added.

### UI control bridge (partial)
- Commands that are “UI intents” currently emit socket events: `io.emit('commander-action', { action: '...' })`
- Client receives these actions in `client/app.js` → `handleCommanderAction(...)`
- **Gap:** the handler supports only a subset of actions the registry emits.

### Review surface (exists)
- Review Console (docked) + Worktree Inspector (modal) already support:
  - Sections: Terminals / Files / Commits / Diff (Diff supports Open + Embed)
  - Layout presets: Default / Review / Deep / Terminals / Code

---

## Goal definition (what “100% UI control” means)

To count as “full UI control”, the system must support:

1) **Everything clickable in the UI** can be executed as a command:
   - either as a *UI command* (drives the browser to perform the action), or
   - as a *server command* (calls the same backend endpoint the UI calls) with UI updating accordingly.
2) Commands are **semantic**, not “click button X”.
3) Voice + Commander both use the **same** command surface:
   - Voice: transcript → `{ command, params }` → `commandRegistry.execute(...)`
   - Commander typed: same.
4) It is **multi-provider extensible**:
   - Not hard-coded for Claude vs Codex vs future.
5) Capabilities + help text + voice LLM prompt are **automatically in sync**:
   - adding a new command updates discovery + help + voice LLM prompt without additional manual edits.

---

## Inventory: major UI surfaces & actions (exhaustive categories)

This section enumerates what must be commandable. Later sections map these to concrete missing commands/APIs.

### A) Global navigation / panels
- Dashboard (including overlays: telemetry/activity/etc.)
- Workspaces / tabs (new, close, switch)
- Queue
- Tasks
- PRs
- Settings
- Commander panel
- History / Conversations browser (Claude + Codex + future providers)

### B) Workspace / worktree management
- Add worktree
- Remove worktree
- Focus worktree (show only that worktree’s terminals)
- Show all worktrees
- Highlight worktree in sidebar

### C) Terminal / session lifecycle
- Focus terminal
- Start Claude in a session
- Stop / kill / restart / destroy session
- Clear terminal
- Scroll top/bottom
- Send input to session
- Broadcast to multiple sessions

### D) Queue item lifecycle (the big one)
Queue “detail panel” has a large set of operations that must be commandable:

Navigation / selection:
- Open Queue
- Select queue item by ID / PR / ticket
- Next / Prev item
- Filters (Mine/All; tier filters; triage/unreviewed/blocked; search)
- Refresh

Review actions:
- Open PR (GitHub)
- Open Diff
- Approve / Request changes
- Merge
- Start/Stop review timer
- Spawn automations: Reviewer / Fixer / Recheck / Overnight

Metadata editing:
- Tier (All/T1/T2/T3/T4/None)
- Change risk
- pFailFirstPass, verify minutes
- Done / Reviewed toggles
- Outcome
- Claim / Release
- Assign / Unassign
- Notes / Fix request
- Ticket link
- Prompt Artifact link (open local prompt)
- Record store (private/shared/encrypted promotion)

Dependencies:
- Add/remove deps
- Dependency graph open + controls (depth, view, pins, satisfied filter)
- Suggested deps
- Conflicts view (ticket conflicts / refresh)
- Pairing recommendations view

### E) Review Console / Worktree Inspector
- Open Review Console for selected item/worktree/session
- Open Worktree Inspector for path
- Toggle sections (Terminals/Files/Commits/Diff)
- Apply preset layouts
- Diff Open/Embed toggle (persisted)
- Open file in editor (if supported)
- Open “Open folder” for inspector’s path

### F) Tasks (Trello provider UI)
If “everything in UI” includes Tasks, then commandability includes:
- Board selection / repo mapping changes
- List selection
- Card selection
- Move cards / update status
- Checklists CRUD (if present in UI)
- Attachments (open)
- Comments (add)
- Create cards/lists (if UI supports)

### G) Settings
At minimum, these should be settable/readable via commands:
- Branch label settings (prefix hide + color-coding toggles)
- Review Console layout/sections preferences
- Queue automation toggles (Auto Diff/Auto Console/Auto Next/etc.)
- Voice settings (enable/disable LLM fallback, model selection) if exposed

---

## Concrete gaps (what’s missing today)

### Gap 1 — Command registry emits actions the UI does not handle

`server/commandRegistry.js` emits these actions that are **not currently implemented** in `client/app.js#handleCommanderAction`:

- `add-worktree`
- `remove-worktree`
- `new-tab`
- `close-tab`
- `open-folder`
- `open-diff-viewer`
- `scroll-to-top`
- `scroll-to-bottom`
- `clear-terminal`
- `restart-session`
- `kill-session`
- `destroy-session`
- `server-control` (stop/restart/kill)
- `build-production`
- `start-agent`
- `git-pull-all`
- `git-status-all`
- `stop-all-claudes`
- `start-all-claudes`
- `refresh-all`

**Impact:** Commander/voice can “successfully execute” commands server-side, but the UI does nothing (or logs “Unknown commander action”).

**Fix approach (recommended):**
- Add full handler coverage in the client (one PR; easy, high leverage).
- Add a unit test that ensures “all registry-emitted `action`s are handled client-side”.

### Gap 2 — Queue + Review Console operations are not exposed as commands

Even though Queue/Review Console features exist, there are no semantic commands for:
- Selecting items by PR URL / PR number / ticket URL
- Approve/request-changes/merge via Queue
- Open Review Console / Inspector for the currently selected queue item
- Editing any Queue metadata (tier/risk/claim/assign/outcome/notes/etc.)
- Dependency operations (deps add/remove/suggest/graph)
- Spawning reviewer/fixer/recheck/overnight for the selected item

**Impact:** voice/Commander can open Queue, but cannot actually *operate* the review workflow without manual clicking.

### Gap 3 — Missing a “Commander Context” endpoint for LLM/automation routing

Voice LLM fallback needs **current UI state** to resolve ambiguous intents:
- current workspace
- currently selected queue item ID + label + kind (pr/worktree/session)
- currently focused worktree/session
- lists of visible worktrees + their branches + tags
- queue list summary (top N items + tiers + claimed/assigned state)

Right now voice has a `setContext(...)` method, but there is no canonical “context feed” and no endpoint like:
- `GET /api/commander/context`

**Impact:** “do X for *this* PR / the one I’m looking at” is hard to interpret reliably.

### Gap 4 — No single “semantic command model” for future providers

We currently have a mix of:
- UI-driven actions (`commander-action` socket events)
- Server-only endpoints (e.g. tasks APIs)
- Provider-specific session logic (Claude vs Codex vs future)

**Impact:** adding a third provider risks hard-coded branching throughout the system.

---

## Proposed architecture (minimal + future-proof)

### 1) Expand `CommandRegistry` to represent *effects*

Add optional metadata to each command:
- `effects.uiActions[]`: list of `commander-action`s it may emit
- `effects.serverCalls[]`: optional list of backend operations invoked
- `effects.reads[]`: context/data it requires (queue selection, workspace ID, etc.)

This enables:
- automatic docs/help generation
- validation (server can assert it’s not emitting actions the client doesn’t support)

### 2) Add `CommandContextService` + endpoint

Add:
- `GET /api/commander/context`

The context should include (minimum):
- `activeWorkspaceName`
- `activeWorkspaceId`
- `selectedQueueItemId` (if any)
- `sessions[]` (id, cwd, branch, status, worktreeId)
- `worktrees[]` (id, branch, tier, tags, paths if safe)
- `queueSummary[]` (top N visible items with ids + labels + kind + tier + claimed/assigned)

Sources:
- server already has many pieces (`sessionManager`, process/task record services)
- client can push “selected item / UI focus” back to server via a tiny socket event, which the server stores for context.

### 3) Command resolution strategy (voice + typed Commander)

- Voice:
  1) rule patterns (fast)
  2) LLM fallback (already includes capabilities; add `GET /api/commander/context` data too)
- Commander typed:
  - allow freeform text → optional LLM parsing to `{ command, params }` using the same prompt logic as voice, but without speech recognition (future).

### 4) Provider plug-in interface (Claude/Codex/future)

Define a provider interface like:
- `id` (e.g. `claude`, `codex`)
- `displayName`
- `listSessions()`
- `resumeSession(resumeId|sessionId)`
- `searchHistory(query, filters)`
- `getTranscript(sessionId)`

Then:
- History UI becomes provider-agnostic (filters are `providerIds[]`)
- Voice/Commander “resume” becomes provider-agnostic:
  - `history/resume { providerId?, resumeId }`

---

## Phase 3 implementation plan (PR-sized tasks, in priority order)

### P3-CMD-01 — Implement missing `handleCommanderAction` cases (high leverage)
**Goal:** every command in `server/commandRegistry.js` causes the intended UI behavior.

Implement client-side actions for the missing list in **Gap 1**.

Acceptance:
- executing each command via `POST /api/commander/execute` produces visible UI change or expected terminal behavior.
- add a unit test that compares:
  - actions emitted by `commandRegistry` vs actions implemented in client.

### P3-CMD-02 — Add “Queue operations” commands (select/next/prev/open console/diff)
Add semantic commands like:
- `queue/open`
- `queue/select` `{ id }`
- `queue/select-by` `{ kind: 'pr'|'ticket'|'record', value }` (PR URL/#, ticket URL, etc.)
- `queue/next`, `queue/prev`
- `queue/open-diff`
- `queue/open-console` (Review Console)
- `queue/open-inspector`

### P3-CMD-03 — Add “Queue review outcome” commands (approve/changes/merge)
Commands (server or UI-driven depending on architecture):
- `queue/review/approve`
- `queue/review/request-changes`
- `queue/review/merge`
- `queue/review/start-timer`, `queue/review/stop-timer`

### P3-CMD-04 — Add “Queue metadata editing” commands (tier/risk/claim/assign/etc.)
Commands:
- `queue/set-tier { tier }`
- `queue/set-risk { risk }`
- `queue/set-outcome { outcome }`
- `queue/claim`, `queue/release`
- `queue/assign { identity }`, `queue/unassign`
- `queue/set-notes { notes }`
- `queue/set-ticket { urlOrId }`
- `queue/open-prompt` (local prompt artifact)
- `queue/record-store { visibility }`

### P3-CMD-05 — Add dependency commands (deps/graph/conflicts/pairing)
Commands:
- `queue/deps/add { depIds[] }`
- `queue/deps/remove { depIds[] }`
- `queue/deps/graph/open { depth?, view? }`
- `queue/deps/suggest`
- `queue/conflicts/open`, `queue/conflicts/refresh`
- `queue/pairing/open`

### P3-CMD-06 — Add `GET /api/commander/context` and feed it to voice LLM
Acceptance:
- Voice parsing can reliably resolve “this PR / current item / next item”.

### P3-CMD-07 — Auto-generate Voice rule patterns (optional, but reduces drift)
Add optional `aliases` to command definitions and generate `patterns` for exact matching from those aliases.

### P3-CMD-08 — Provider-agnostic History/Resume commands (Claude/Codex/future)
Commands:
- `history/open { providerIds? }`
- `history/search { query, providerIds? }`
- `history/resume { providerId?, resumeId }`

---

## Debugging / user-facing “how to find the view” (for Review Console)

If you have a Queue item selected and it’s linked to a local session/worktree:
- Click **🖥 Console** in the Queue detail header to open the docked Review Console.
- Or click **🗂 Inspect** for the modal Worktree Inspector.
- Inside the Review Console, use **Layout** to toggle sections (Terminals/Files/Commits/Diff) and presets.

If those buttons are missing or “do nothing”:
- The queue item likely has no `sessionId`/`worktreePath`, *or* the stored path is stale.
- Recent fixes auto-migrate stale paths when the repo root moved (see `server/workspaceManager.js#normalizeWorkspacePaths`).

Quick sanity checks:
- Open DevTools → Network and click **🗂 Inspect** again; you should see a request to `/api/worktree-git-summary?...`.
- If you are running an older orchestrator checkout, update to the latest `main` before debugging UI behavior (several “Inspect does nothing” root causes were fixed on 2026-01-31).
