# Tasks / Ticketing Providers (v0)

Goal: expose “work to do” inside Agent Orchestrator via a pluggable provider interface.

Initial provider: **Trello** (read-only).

This is intentionally *provider-agnostic* so we can later add Jira / Notion / Linear / a custom OSS tracker, or combine multiple providers.

---

## Design goals

- **No secrets in repo**: credentials must come from environment or local untracked files.
- **Cache first**: avoid spamming external APIs while staying reasonably fresh.
- **UI + API**: humans browse tasks; agents can query tasks via the orchestrator API.
- **Pluggable**: provider-specific logic is isolated from the rest of the codebase.

---

## Credentials (Trello)

Server reads credentials from:

1) Environment variables:
- `TRELLO_API_KEY`
- `TRELLO_TOKEN` (or `TRELLO_API_TOKEN`)

2) Fallback file (optional):
- `~/.trello-credentials` with:
  - `API_KEY=...`
  - `TOKEN=...`

Never commit these values.

---

## API endpoints (server)

- `GET /api/tasks/providers`
  - Returns configured providers + capabilities.
- `GET /api/tasks/boards?provider=trello[&refresh=true]`
- `GET /api/tasks/boards/:boardId/lists?provider=trello[&refresh=true]`
- `GET /api/tasks/boards/:boardId/cards?provider=trello[&q=...][&updatedSince=ISO][&refresh=true]`
- `GET /api/tasks/lists/:listId/cards?provider=trello[&q=...][&updatedSince=ISO][&refresh=true]`
- `GET /api/tasks/cards/:cardId?provider=trello[&refresh=true]`

Notes:
- `refresh=true` bypasses cache for that request.
- `updatedSince` is currently applied as a client-side filter using `dateLastActivity`.

---

## Caching strategy (v0)

We use an in-memory TTL cache (`server/utils/ttlCache.js`) with conservative defaults.

Intended behavior:
- Boards: cache ~5 minutes
- Lists: cache ~60 seconds
- Cards + card detail: cache ~20 seconds

Rationale:
- Cards change frequently; keep short TTL.
- Boards/lists are relatively stable; longer TTL is safe and reduces API load.

Future: replace TTL-only cache with “stale-while-revalidate” + optional persistence (so a restart doesn’t cause an immediate API spike).

---

## Provider interface (v0)

Provider objects should expose:

- `id`, `label`
- `isConfigured()`
- `getCapabilities()` (read/write support)
- `listBoards()`
- `listLists({ boardId })`
- `listCards({ listId, q, updatedSince })`
- `getCard({ cardId })`

See:
- `server/taskTicketingService.js`
- `server/taskProviders/trelloProvider.js`

---

## UI (v0)

“✅ Tasks” button opens a modal that:
- selects provider → board → list
- filters cards by text + “updated window”
- shows card detail on click (desc + link)

Notes:
- Default “updated window” is **Any time** to avoid hiding older cards.
- Default list selection is **All lists** (board-wide cards) to match the common mental model of “boards have cards”.

Files:
- `client/index.html` (header button)
- `client/app.js` (`showTasksPanel()`)
- `client/styles.css` (modal styles)
