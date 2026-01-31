# Full UI control via Commands (Voice + Commander) — Gap analysis

Date: 2026-01-31  
Owner intent: “Do *everything* the UI can do” via (a) voice commands, and (b) typing to **Commander Claude** — both routed through the same shared command surface, and extensible to future providers (e.g. “Open Code”).

This doc is **implementation-oriented**: it enumerates the missing pieces, proposes a minimal architecture that stays in sync automatically, and breaks work into PR-sized tasks.

---

## Status (updated 2026-02-01)

Shipped (merged to `main`):
- Command registry + commander execute/capabilities endpoints (Phase 4 foundation).
- UI action coverage: every `commander-action` emitted by `server/commandRegistry.js` is handled in `client/app.js#handleCommanderAction` (guarded by `tests/unit/commanderActionCoverage.test.js`).
- Queue parity for the main review workflow:
  - Navigation/selection helpers (`queue-prev/next/select/...`)
  - Review lifecycle (approve / request-changes / merge)
  - Metadata edits (tier/risk/outcome/notes/claim/assign)
  - Dependencies/pairing/conflicts (deps add/remove/graph, pairing view, conflicts refresh)
  - Spawn automations (reviewer/fixer/recheck/overnight)
- Review Console controls (layout presets + section toggles + fullscreen/docked + diff open/embed).
- Provider-agnostic History surface (Claude + Codex) including resume.
- Voice improvement: exact-match parsing auto-supports any new **no-required-param** CommandRegistry commands by name (PR #528).

Remaining (current known):
- Expand the Commander/voice “context snapshot” to include richer Queue summaries (top-N visible items + tiers/claims) for better “this/next PR” disambiguation.
- Continue migrating any remaining “UI-only” actions into the semantic command surface as they are identified.

Related plan (separate track):
- `PLANS/2026-01-31/DISCORD_BOT_INTEGRATION_PLAN.md`

## Ground truth / current state (already shipped)

### Shared command surface (exists)
- Server-side semantic command registry: `server/commandRegistry.js`
  - Discovery: `GET /api/commander/capabilities` (driven by the registry)
  - Execution: `POST /api/commander/execute` → `commandRegistry.execute(...)`
- Voice pipeline: `server/voiceCommandService.js`
  - Rule-based parse first, then LLM fallback (Ollama/Claude)
  - LLM prompt already includes `commandRegistry.getCapabilities()`, so the *LLM path* stays automatically up to date as commands are added.

### UI control bridge (shipped)
- Commands that are “UI intents” currently emit socket events: `io.emit('commander-action', { action: '...' })`
- Client receives these actions in `client/app.js` → `handleCommanderAction(...)`
- This is enforced by `tests/unit/commanderActionCoverage.test.js` to prevent drift.

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

### Gap 1 — CLOSED: registry-emitted UI actions are all handled

This was the original biggest drift risk; it is now fixed and guarded by unit test coverage.

### Gap 2 — Queue + Review Console operations are not exposed as commands

Even though Queue/Review Console features exist, there are still missing semantic commands for:
- Selecting items by PR *number* (without needing full URL), and richer “select by …” helpers (repo aliases, short PR refs, etc.)
- Editing remaining Queue metadata fields (pFailFirstPass / verifyMinutes / promptRef / ticket link / done/reviewed toggles / etc.)
- Spawning reviewer/fixer/recheck/overnight for the selected item
- Record store actions (private/shared/encrypted promotion)

Already shipped (baseline Queue control):
- `open-queue`, `queue-next`, `queue-blockers`, `queue-triage`, `queue-conveyor-t2`
- Navigation/selection helpers:
  - `queue-prev`, `queue-select { id }`
  - `queue-select-by-pr-url { url }`, `queue-select-by-ticket { ticket }`
  - `queue-refresh`
- Review surface:
  - `queue-open-console`, `queue-open-inspector`, `queue-open-diff`
  - `queue-open-prompt`
- Review lifecycle:
  - `queue-review-timer-start`, `queue-review-timer-stop`
  - `queue-approve`, `queue-request-changes`, `queue-merge`
- Metadata:
  - `queue-set-tier { tier }`, `queue-set-risk { risk }`, `queue-set-outcome { outcome }`, `queue-set-notes { notes }`
  - `queue-claim { who? }`, `queue-release`, `queue-assign { who }`, `queue-unassign`
- Dependencies/pairing/conflicts:
  - `queue-deps-add { dependencyIds }`, `queue-deps-remove { dependencyIds }`, `queue-deps-graph { depth?, view? }`
  - `queue-pairing`, `queue-conflicts-refresh`

**Impact:** voice/Commander can run most of the review workflow, but there are still “last mile” gaps for full parity (spawn automations, a few metadata fields, and richer selection helpers).

### Gap 3 — Missing a “Commander Context” endpoint for LLM/automation routing

Voice LLM fallback needs **current UI state** to resolve ambiguous intents:
- current workspace
- currently selected queue item ID + label + kind (pr/worktree/session)
- currently focused worktree/session
- lists of visible worktrees + their branches + tags
- queue list summary (top N visible items + tiers + claimed/assigned state)

Status:
- `GET /api/commander/context` exists (for Commander + automation visibility).
- Voice context is pushed from the client via `POST /api/voice/context` (and included in the LLM prompt).

Remaining:
- Expand commander context payload to include richer queue summaries and per-worktree metadata to improve “this PR / next PR” resolution.

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

## Phase 4 implementation plan (PR-sized tasks, in priority order)

### P4-CMD-01 — Implement missing `handleCommanderAction` cases (high leverage)
**Goal:** every command in `server/commandRegistry.js` causes the intended UI behavior.

Status: ✅ shipped (guarded by unit test).

Acceptance:
- executing each command via `POST /api/commander/execute` produces visible UI change or expected terminal behavior.
- add a unit test that compares:
  - actions emitted by `commandRegistry` vs actions implemented in client.

### P4-CMD-02 — Add “Queue operations” commands (select/next/prev/open console/diff)
Add semantic commands like:
- `queue/open`
- `queue/select` `{ id }`
- `queue/select-by` `{ kind: 'pr'|'ticket'|'record', value }` (PR URL/#, ticket URL, etc.)
- `queue/next`, `queue/prev`
- `queue/open-diff`
- `queue/open-console` (Review Console)
- `queue/open-inspector`

Status: ✅ shipped (Queue control surface is commandable end-to-end).

### P4-CMD-03 — Add “Queue review outcome” commands (approve/changes/merge)
Commands (server or UI-driven depending on architecture):
- `queue/review/approve`
- `queue/review/request-changes`
- `queue/review/merge`
- `queue/review/start-timer`, `queue/review/stop-timer`

Status: ✅ shipped (approve/request-changes/merge + review timers are commandable).

### P4-CMD-04 — Add “Queue metadata editing” commands (tier/risk/claim/assign/etc.)
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

### P4-CMD-05 — Add dependency commands (deps/graph/conflicts/pairing)
Commands:
- `queue/deps/add { depIds[] }`
- `queue/deps/remove { depIds[] }`
- `queue/deps/graph/open { depth?, view? }`
- `queue/deps/suggest`
- `queue/conflicts/open`, `queue/conflicts/refresh`
- `queue/pairing/open`

### P4-CMD-06 — Add `GET /api/commander/context` and feed it to voice LLM
Acceptance:
- Voice parsing can reliably resolve “this PR / current item / next item”.

Status: ✅ shipped (context endpoints exist; voice context is pushed and used in the LLM prompt).

### P4-CMD-07 — Auto-generate Voice rule patterns (optional, but reduces drift)
Add optional `aliases` to command definitions and generate `patterns` for exact matching from those aliases.

### P4-CMD-08 — Provider-agnostic History/Resume commands (Claude/Codex/future)
Commands:
- `open-history { source?, query?, repo?, branch?, dateFilter? }`
- `resume-history { id, source?, project? }`

Status: ✅ shipped (2026-01-31) via `server/commandRegistry.js` + `client/app.js` + `server/voiceCommandService.js`.

---

## Debugging / user-facing “how to find the view” (for Review Console)

If you have a Queue item selected and it’s linked to a local session/worktree:
- Click **🖥 Console** in the Queue detail header to open the docked Review Console.
- Or click **🗂 Inspect** for the modal Worktree Inspector.
- Inside the Review Console, use **Layout** to toggle sections (Terminals/Files/Commits/Diff) and presets.

Phase 4 note (2026-01-31): Review Console controls are now commandable via Commander/Voice:
- `open-review-console { sessionId? | worktreePath? }`
- `review-console-set-preset { preset }`
- `review-console-set-window { mode }`
- `review-console-toggle-section { section }`
- `review-console-files-view { view }`
- `review-console-diff-open`
- `review-console-diff-embed { enabled }`
- `close-review-console`

If those buttons are missing or “do nothing”:
- The queue item likely has no `sessionId`/`worktreePath`, *or* the stored path is stale.
- Recent fixes auto-migrate stale paths when the repo root moved (see `server/workspaceManager.js#normalizeWorkspacePaths`).

Quick sanity checks:
- Open DevTools → Network and click **🗂 Inspect** again; you should see a request to `/api/worktree-git-summary?...`.
- If you are running an older orchestrator checkout, update to the latest `main` before debugging UI behavior (several “Inspect does nothing” root causes were fixed on 2026-01-31).
Status: ✅ shipped (deps add/remove/graph + conflicts refresh + pairing open are commandable).
