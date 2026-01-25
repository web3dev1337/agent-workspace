# PR Plan: Trello “Parity” Iteration (Labels + Custom Fields Editing)

Goal: push the Tasks/Trello UI closer to “Trello parity” while keeping the provider abstraction clean.

Scope (this PR):
- Labels:
  - fetch board labels
  - show labels (already)
  - **edit card labels** (add/remove)
- Custom fields:
  - fetch board custom fields (already)
  - show custom fields (already)
  - **edit card custom fields** (text/number/checkbox/date/list)

Non-goals (later PRs):
- Attachments, cover images, checklists full CRUD (beyond Dependencies convention)
- List creation/reorder, card creation, full drag reorder within list
- Multi-board aggregation views

---

## Endpoints (provider-agnostic)

- `GET /api/tasks/boards/:boardId/labels?provider=trello`
- `PUT /api/tasks/cards/:cardId?provider=trello`
  - support `idLabels: string[]`

Custom fields editing:
- `PUT /api/tasks/cards/:cardId/custom-fields/:customFieldId?provider=trello`
  - body depends on field type (text/number/date/checkbox/list)

---

## UI

Card detail panel:
- Labels editor:
  - show selected labels
  - click to toggle labels
  - optional search
- Custom fields editor:
  - render inputs by type
  - optimistic save with error toast

---

## Tests

- Unit: Trello provider request shaping for label updates + custom field updates.
- E2E (proxy): mocked APIs to cover label toggle + custom field update UI rendering.

---

## Checklist

- [x] Board labels endpoint + caching
- [x] Card label update support
- [x] Custom field update endpoints (server + provider)
- [x] UI: labels editor
- [x] UI: custom fields editor
- [x] Tests: unit + e2e
- [ ] Commit + push + open PR
