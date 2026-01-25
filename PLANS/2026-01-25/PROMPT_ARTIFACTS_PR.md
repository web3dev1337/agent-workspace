# PR Plan: Prompt Artifacts (Private by Default, Optional Trello Embed)

Branch: `feat/prompt-artifacts`

Goal: store and reuse **massive prompts** for tiered work (especially Tier 4 greenfield), without requiring a Trello card, while still allowing optional sharing via Trello comments when desired.

## Decisions

- **Trello comments are not canonical storage**.
- Canonical storage for private prompts is local:
  - `~/.orchestrator/prompts/<id>.md`
- If a Trello card exists, we can optionally **embed** the prompt into comments:
  - modes: `snippet | full | chunks`
  - includes `sha256` to detect drift

## API

- `GET /api/prompts` (list recent prompt artifacts)
- `GET /api/prompts/:id` (read prompt + sha256)
- `PUT /api/prompts/:id` body `{ text }` (write prompt)
- `DELETE /api/prompts/:id` (delete)

Optional:
- `POST /api/prompts/:id/embed` body:
  - `{ provider: "trello", cardId: "...", mode: "chunks", maxCharsPerComment: 8000 }`

## Notes

- This is “local/private by default”. Sharing beyond Trello embeds (e.g. committed shared repo, encrypted prompts) is a follow-up PR.

