# Fizzy UI notes (for Trello Kanban inspiration)

Repo: `basecamp/fizzy` (Rails + Hotwire/Stimulus).

Relevant patterns to reuse (UX-wise) in our vanilla JS Orchestrator UI:

## 1) Drag/drop implementation

File: `app/javascript/controllers/drag_and_drop_controller.js`

Key ideas:
- Uses native HTML5 drag/drop events.
- Adds a “dragged item” class for styling.
- Highlights the hovered container with a `hoverContainer` class.
- Optimistically updates counts and DOM placement before submitting the move request.
- Submits the drop via a single POST to a server URL that includes the moved item id.

We’ll mirror this pattern:
- `draggable=true` on Trello cards.
- Column highlight on dragover.
- Optimistic UI move + request to `PUT /api/tasks/cards/:cardId` (`idList=...`).

## 2) Column layout + mobile collapse

File: `app/javascript/controllers/collapsible_columns_controller.js`

Key ideas:
- Columns can be collapsed/expanded; state stored in localStorage.
- On mobile, it scrolls the expanded column into view.

We’ll use this as a “v2” idea:
- For v1, just horizontal scroll columns.
- If it’s still too dense on mobile, add collapse + localStorage later.

