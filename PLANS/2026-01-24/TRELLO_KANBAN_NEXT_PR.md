# Next PR Plan: Trello Kanban Board UI (v1)

Goal: make the **Tasks** experience feel like Trello: boards → lists (columns) → cards, with fast scan + drag/drop moves, while staying compatible with future ticket providers.

This PR is scoped to a **single board view UI** + the minimum backend shape needed to power it efficiently.

---

## User goals / Acceptance criteria

- Browse a board as a **kanban board** (columns for lists, cards within).
- **Drag a card** to another list to move it (Trello `idList` update).
- Click a card to open the existing **detail/edit panel** (title/desc/members/labels/comments).
- Must not spam Trello: use server-side caching and a single “snapshot” fetch per refresh when possible.
- Works even when Trello board-wide cards endpoint fails (fall back to per-list).

Non-goals (later PRs):
- Full Trello parity (labels editing, member assignment, checklists editing, attachments).
- Perfect reordering within a list (pos math), swimlanes, WIP limits.

---

## Backend changes

### 1) Board snapshot API (provider-agnostic wrapper)

Add:
- `GET /api/tasks/boards/:boardId/snapshot?provider=trello[&refresh=true]`

Response:
```json
{
  "provider": "trello",
  "boardId": "…",
  "lists": [{ "id": "…", "name": "…", "pos": 123 }],
  "cardsByList": { "listId": [{ "id": "…", "name": "…", "pos": 123, "dateLastActivity": "…" }] }
}
```

Implementation (Trello):
- Fetch lists: `GET /1/boards/:id/lists?filter=open`
- Fetch cards: prefer `GET /1/boards/:id/cards?filter=open`, but **fallback to per-list** if needed.
- Sort lists by `pos` and cards by `pos`.
- Cache snapshot ~10–20s; `refresh=true` bypasses cache.

### 2) Move card API

Already present:
- `PUT /api/tasks/cards/:cardId` with `{ idList }` (and optional `pos`).

For kanban v1:
- Use `PUT /api/tasks/cards/:cardId` to move card to list.
- Optionally set `pos=top`/`bottom` later; in v1 default to Trello’s behavior or `pos=bottom`.

---

## Frontend changes (client)

### 1) Add “Board” view mode

In the Tasks modal:
- Add a toggle: **List view** (current) vs **Board view** (new).
- Board view requires a board selection; lists dropdown can be hidden/disabled in board view.

### 2) Board layout

- Horizontal scroll container with columns:
  - list title
  - card count
  - cards list (vertical scroll per column)

### 3) Drag/drop move

Use simple HTML5 drag/drop:
- `draggable=true` on cards
- `dragenter/dragover/drop` on columns
- On drop:
  - optimistic UI update (move card)
  - call `PUT /api/tasks/cards/:cardId` with `{ idList: targetListId }`
  - on failure: revert and show toast

### 4) Card click → existing details

Reuse the existing card detail fetch:
- `GET /api/tasks/cards/:cardId`

---

## Tests

- Unit: provider snapshot/grouping logic.
- E2E (safe port): open Tasks modal, switch to Board view (works without Trello configured and doesn’t crash).

---

## Fizzy.do inspiration (analysis notes)

We’ll look at Fizzy for:
- card/list layout patterns
- light UX touches: hover states, column spacing, compact typography
- drag/drop behavior (if present)

We will not copy their stack; we’ll reproduce the UX patterns in our existing vanilla JS client.

---

## Rollout / Risk

- Keep current list-based Tasks view as default.
- Board view is additive; if any Trello edge case occurs, user can still use list view.
- Caching + `refresh=true` avoids Trello API spam while allowing manual refresh.

