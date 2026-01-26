# PR Plan: Prompt Artifacts (Private + Shared/Encrypted + Trello Embed)

Branch: `feat/prompt-artifacts`

Goal: store and reuse **massive prompts** for tiered work (especially Tier 4 greenfield), without requiring a Trello card, while still supporting Trello comment embedding when a card exists.

## Decisions

- **Trello comments are not canonical storage**.
- Canonical storage for private prompts is local:
  - `~/.orchestrator/prompts/<id>.md`
- Shared prompts can live in a repo as a committed file.
- Encrypted shared prompts are supported (repo file encrypted at rest).
- If a Trello card exists, the orchestrator can **embed** the prompt into comments:
  - modes: `snippet | full | chunks`
  - includes `sha256` to detect drift

## API

- `GET /api/prompts` (list recent prompt artifacts)
- `GET /api/prompts/:id` (read prompt + sha256)
- `PUT /api/prompts/:id` body `{ text }` (write prompt)
- `DELETE /api/prompts/:id` (delete)

Repo-backed shared/encrypted prompts:
- `GET /api/prompts/:id?visibility=shared|encrypted&repoRoot=/abs/repo&relPath=path/to/prompt.md`
- `PUT /api/prompts/:id?visibility=shared|encrypted&repoRoot=/abs/repo&relPath=path/to/prompt.md` body `{ text }`

Promotion (private → shared/encrypted):
- `POST /api/prompts/:id/promote` body `{ visibility: "shared"|"encrypted", repoRoot, relPath?, commentPointer? }`

Optional pointer comment (when promoting):
- `commentPointer: { provider: "trello", cardId: "...", repoLabel?: "owner/repo" }`
- This posts a **short pointer** back to the card (id + sha + repo/path), not the full prompt.

Encryption:
- Encrypted operations require `ORCHESTRATOR_PROMPT_ENCRYPTION_KEY` (preferred) or `ORCHESTRATOR_PROMPT_PASSPHRASE`.

Also included:
- `POST /api/prompts/:id/embed` body:
  - `{ provider: "trello", cardId: "...", mode: "chunks", maxCharsPerComment: 8000 }`

## Notes

- This is “local/private by default”, but the Queue UI now supports selecting a store (`private|shared|encrypted`) and promoting artifacts.
