# Codex parity PR breakdown (2026-02-06)

Goal: ship parity in merge-safe slices.

---

## PR 1 — Command catalog foundation

Title:
- `feat(commands): add unified command catalog for voice/commander/ui`

Scope:
- add `GET /api/commands/catalog`
- enrich command metadata (`safetyLevel`, `surfaces`, aliases)
- wire voice fallback prompt to catalog

Validation:
- unit tests for catalog schema
- commander/voice parsing smoke tests

---

## PR 2 — Thread persistence service

Title:
- `feat(threads): add persisted thread model and lifecycle APIs`

Scope:
- add `threadService`
- add list/create/close/archive endpoints
- map threads to workspace/worktree/session ids

Validation:
- unit tests for create/close/archive behavior
- migration-safe startup tests

---

## PR 3 — New chat lifecycle endpoint

Title:
- `feat(threads): one-click new chat lifecycle (worktree + session + thread)`

Scope:
- single endpoint that orchestrates:
  - worktree ensure/create
  - session start
  - thread creation
- lifecycle policy options for close/remove/archive

Validation:
- integration tests for end-to-end create flow

---

## PR 4 — Simple mode shell (left rail)

Title:
- `feat(ui): add simple mode projects/threads shell`

Scope:
- left rail with projects + threads
- thread list and selection flow
- “new chat” button
- mode toggle simple/advanced

Validation:
- unit tests where applicable
- manual UX sanity on desktop widths

---

## PR 5 — Thread pane actions

Title:
- `feat(ui): add thread action pane and quick review route actions`

Scope:
- quick actions from thread:
  - focus linked session
  - open review console
  - open diff
  - archive/close thread

Validation:
- e2e smoke for thread action flow

---

## PR 6 — Scheduler templates (“cron skills”)

Title:
- `feat(scheduler): add template jobs and scheduler template APIs`

Scope:
- template registry in scheduler service
- add template APIs
- run-now + dry-run support for templates

Validation:
- unit tests for template expansion and policy checks

---

## PR 7 — Scheduler UX for simple mode

Title:
- `feat(ui): add cron skills builder and status panel`

Scope:
- human-friendly scheduler form:
  - pick template
  - cadence
  - enable/disable
  - run now
- recent run status/errors in UI

Validation:
- e2e flow: create template job, run now, verify audit output

---

## PR 8 — Docs + onboarding + hardening

Title:
- `docs(ui): simple mode onboarding and lifecycle semantics`

Scope:
- docs:
  - simple mode quick start
  - close/remove/archive semantics
  - command catalog + cron skills
- keyboard shortcuts and usability polish

Validation:
- docs review + regression pass

---

## Cross-PR constraints

- Keep existing advanced workflows operational in every PR.
- Maintain Windows + Linux/WSL test coverage.
- Avoid large mixed refactors; each PR should be independently mergeable.

