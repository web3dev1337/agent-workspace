# Codex parity implementation plan (2026-02-06)

Scope: implement a Codex-style simple workflow layer (`projects + chats + scheduled skills`) without removing current orchestrator workflows.

Reference:
- `PLANS/2026-02-06/CODEX_PARITY_GAP_ANALYSIS.md`

---

## 1) Delivery strategy

Principles:
- additive changes only (no advanced workflow regression)
- small PR slices with green tests
- server contracts before UI wiring

Mode model:
- `simple` mode: project/chat shell + review route + automations
- `advanced` mode: existing workspace/worktree/session UI

---

## 2) Phase plan

## Phase 0 — Contracts and catalogs (P0)

Goal:
- unify command metadata and make every control surface consume the same command definitions.

Deliverables:
- new API: `GET /api/commands/catalog`
  - source: `commandRegistry` + command metadata enrichments
- include fields:
  - `name`, `category`, `description`, `params`
  - `safetyLevel` (`safe`, `caution`, `dangerous`)
  - `surfaces` (`ui`, `voice`, `commander`, `scheduler`)
  - `aliases` (voice/commander friendly)
- update voice fallback prompt construction to use catalog payload.

Files likely touched:
- `server/commandRegistry.js`
- `server/index.js`
- `server/voiceCommandService.js`

Acceptance:
- voice parse and commander text execution both resolve commands from shared catalog metadata
- catalog endpoint used by settings/help UI

---

## Phase 1 — Thread model + lifecycle (P0)

Goal:
- create first-class `thread` abstraction mapped to worktree/session.

Data model:
- new persisted store:
  - `~/.orchestrator/threads.json` (or workspace-scoped equivalent)
- thread shape:
  - `id`
  - `workspaceId`
  - `projectId` (alias of workspace/project key)
  - `title`
  - `worktreeId`
  - `worktreePath`
  - `sessionIds`
  - `provider` (`claude`, `codex`, future)
  - `status` (`active`, `closed`, `archived`)
  - timestamps (`createdAt`, `updatedAt`, `lastActivityAt`)

APIs:
- `GET /api/threads?workspaceId=...`
- `POST /api/threads/create`
  - create/select worktree
  - create sessions
  - persist thread
- `POST /api/threads/:id/close`
  - configurable lifecycle action
- `POST /api/threads/:id/archive`

Files likely touched:
- `server/index.js`
- new `server/threadService.js`
- `server/sessionManager.js` (link hooks)
- `server/workspaceManager.js` (integration)

Acceptance:
- one API call can create a usable “chat/thread” with linked session(s)
- close/archive operations are explicit and reflected in UI

---

## Phase 2 — Simple mode shell UI (P0)

Goal:
- add left-rail project/thread workflow while preserving current tabs/grid.

UI components:
- left rail:
  - projects
  - per-project threads
  - quick actions (`new chat`, `open review route`, `run automation`)
- thread main pane:
  - prompt/action input
  - linked session status
  - quick open to review console / diff / files

Behavior:
- selecting thread focuses linked session/worktree context
- “new chat” invokes thread create API
- “close chat” uses explicit lifecycle options

Files likely touched:
- `client/app.js`
- `client/index.html`
- `client/styles.css`
- optional new module: `client/simple-mode.js`

Acceptance:
- user can run end-to-end workflow from one page without opening advanced queue by default
- advanced mode remains fully available

---

## Phase 3 — Cron skills UX (P0/P1)

Goal:
- convert scheduler JSON into user-facing skill templates.

Deliverables:
- scheduler template registry:
  - `review-route-sweep`
  - `stuck-task-check`
  - `dependency-blocked-report`
  - `health-snapshot`
- UI:
  - enable/disable
  - cadence picker
  - dry-run
  - last-run status + errors

APIs:
- `GET /api/scheduler/templates`
- `POST /api/scheduler/jobs/from-template`

Files likely touched:
- `server/schedulerService.js`
- `server/index.js`
- `client/app.js`
- `client/index.html`

Acceptance:
- users can create useful automations without editing JSON
- every run is auditable and reversible (disable/pause)

---

## Phase 4 — Hardening and polish (P1)

Goal:
- quality and parity confidence.

Deliverables:
- keyboard shortcuts for simple mode navigation
- improved onboarding/tooltips
- docs:
  - simple mode quick start
  - lifecycle semantics
  - automation safety model

Acceptance:
- no regression in unit tests
- targeted e2e flows for simple mode + review route + cron skills

---

## 3) Testing strategy

Unit:
- thread service lifecycle
- command catalog schema and safety metadata
- scheduler template expansion logic

Integration:
- create thread -> spawn sessions -> open review
- close thread behavior variants
- command catalog consumed by voice parse path

E2E:
- simple mode:
  1) create project thread
  2) run prompt dispatch
  3) open review route and step next
  4) schedule skill and run once

Platform matrix:
- Linux/WSL
- Windows

---

## 4) Rollout and migration

Migration:
- no destructive migration of existing workspaces
- optional backfill:
  - infer initial thread records from active sessions/worktrees

Feature flag:
- `ui.simpleMode.enabled` default off for first release
- enable-by-default after stabilization

Telemetry:
- measure adoption:
  - simple mode open rate
  - new chat creation success rate
  - scheduler template usage

---

## 5) Out of scope for this phase

- replacing advanced queue/review surfaces
- full client plugin platform
- hosted sync/SaaS layer

---

## 6) Exit criteria

- simple-mode workflow usable for daily Tier-3 review work
- unified command catalog powering voice + commander + UI help
- cron-skills templates usable without raw JSON edits
- no major regressions in existing advanced workflows

