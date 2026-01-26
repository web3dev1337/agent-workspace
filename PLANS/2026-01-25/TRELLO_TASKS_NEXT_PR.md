# Next PR Plan: Trello Tasks (Metadata + Edits + Dependencies)

Status (2026-01-26): **shipped** (built across PRs #179/#180 and follow-ups; this doc is kept as historical plan + checklist).

This follows the merged Trello Tasks v0 work (PR #178) and expands it toward “Trello parity” while keeping the provider abstraction clean so we can swap/augment providers later (Jira/Linear/Notion/custom).

Related:
- Kanban v1 plan: `PLANS/2026-01-24/TRELLO_KANBAN_NEXT_PR.md`
- Provider/API notes: `PLANS/2026-01-24/TASKS_TICKETING.md`
- Fizzy inspiration: `PLANS/2026-01-24/FIZZY_UI_NOTES.md`

---

## Goals / acceptance criteria

- **Card metadata is complete enough** to avoid switching to Trello for routine review:
  - members/assignees (names + count)
  - labels
  - due date (if any)
  - activity + comments (already shown; keep)
  - checklists (at least “Dependencies”; ideally all checklists read-only)
- **Edits work reliably**:
  - edit title/description
  - move card between lists (and via drag/drop in board view)
  - add comment
  - assign/unassign members (minimal UI)
  - set/clear due date (minimal UI)
- **Dependencies** are supported and usable by humans + agents:
  - display dependencies for a card
  - add/remove dependency
- mark dependency satisfied (v1)
- **Agent-ready API** exists for all actions above (not just UI buttons).
- **No port 3000 usage** for tests (keep Playwright safe port flow).

Out of scope for this PR (next PRs):
- Full Trello parity (attachments upload, cover images, full label CRUD, rules/automations).
- Perfect card ordering within a list (pos math) beyond “top/bottom”.
- Multi-provider aggregation UX (we keep the interface compatible, but focus on Trello first).

---

## Design decisions

### 1) Dependency representation (Trello)

Trello doesn’t have a native “dependency” object.

We’ll represent dependencies using a **checklist convention**:
- Checklist named: `Dependencies`
- Each item text contains either:
  - a Trello card URL, or
  - a shortLink, or
  - `Card Name — URL`

This is:
- portable (shows up in Trello UI),
- collaborative (humans can edit in Trello if needed),
- easy for the orchestrator + agents to parse and mutate via API.

### 2) Caching

- Keep existing in-memory TTL cache.
- For write operations: invalidate `trello:card:${id}` and snapshot keys for that board.
- Prefer “stale-while-revalidate” later; not required in this PR.

---

## Backend work (API + provider)

### 1) Capabilities

Update provider capabilities to reflect write support:
- `addComment`
- `updateCard` (name/desc/due/idList/idMembers/closed)
- dependency checklist ops (new)

### 2) New/expanded endpoints

Keep endpoints provider-agnostic. Proposed additions:

- `GET /api/tasks/boards/:boardId/members?provider=trello`
  - for “assign member” UI and agent usage

- `GET /api/tasks/cards/:cardId/dependencies?provider=trello`
  - returns parsed deps + raw checklist metadata

- `POST /api/tasks/cards/:cardId/dependencies?provider=trello`
  - body: `{ url?: string, cardId?: string, name?: string }`

- `DELETE /api/tasks/cards/:cardId/dependencies/:itemId?provider=trello`

Follow-up items (next PRs):
- `PUT /api/tasks/cards/:cardId/dependencies/:itemId?provider=trello` (toggle complete)

### 3) Trello provider methods (new)

- `listBoardMembers({ boardId })`
- `getDependencies({ cardId })`
- `addDependency({ cardId, … })`
- `removeDependency({ cardId, itemId })`
- `toggleDependency({ cardId, itemId, state })`

---

## Frontend work (Tasks modal)

### 1) Card detail additions

Add minimal, fast controls:
- Members section:
  - show current members
  - “Assign” dropdown (board members)
- Due section:
  - show due
  - quick set/clear
- Dependencies section:
  - list parsed dependencies
  - add dependency input (URL/shortLink)
  - remove buttons

### 2) Board view improvements

If time:
- better column scrolling / more compact headers
- show badges on cards (deps count, comments count)

---

## Tests

- Unit:
  - dependency parsing (from checklists)
  - checklist mutation request shaping
  - board member list parsing
- E2E (safe port):
  - open Tasks modal
  - switch to Board view
  - open card detail and see Dependencies block (even if empty)

---

## Checklist

- [x] Backend: provider capabilities reflect writes
- [x] Backend: board members endpoint
- [x] Backend: dependency endpoints + provider implementation
- [x] UI: dependencies view + add/remove (+ toggle)
- [x] UI: member assign/unassign
- [x] UI: due set/clear
- [x] Tests: unit + e2e
- [x] Docs updated (`PLANS/*` + rolling log)
- [x] PR opened + link added to rolling log
