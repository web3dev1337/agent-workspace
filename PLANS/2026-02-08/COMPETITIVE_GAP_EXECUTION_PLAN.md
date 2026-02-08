# Competitive gap execution plan (Phase 5) — 2026-02-08

Owner: Agent Orchestrator
Status: Ready to execute
Input: `PLANS/2026-02-08/SOLOTERM_CODEX_CLAUDE_COMPETITIVE_ANALYSIS.md`

## 1) Objective

Close the highest-value product gaps identified against Solo, Codex app, and adjacent tools while preserving Agent Orchestrator’s core differentiation:
- local-first
- multi-provider
- multi-workspace orchestration
- review workflow depth

## 2) Execution principles

1. Preserve existing advanced workflows; add a simpler top layer, not a replacement.
2. Keep Windows + Linux parity as a release gate for every slice.
3. Prefer additive services/endpoints over invasive rewrites.
4. Land in small mergeable PRs with explicit rollback paths.

## 3) Definition of done

This initiative is done when all conditions hold:
1. New users can do `Project -> New Chat -> Work -> Review Route` from one simple screen.
2. Review Route defaults to dense, single-page behavior with embedded diff and fast next-item loop.
3. A workspace can run reproducible service stacks from a manifest (start/stop/restart/health).
4. Voice, Commander typed commands, and UI automation all rely on one discoverable command catalog contract.
5. Windows + Linux safe tests pass for each production slice.

## 4) Milestones and PR slices

## Milestone M0 — Foundations and guardrails

### PR M0.1 — Command catalog contract v1
Scope:
- Add server endpoint `GET /api/commands/catalog`.
- Expose command metadata from existing registry:
  - `id`, `title`, `aliases`, `params`, `examples`, `safety`, `uiAction`, `providers`.
- Add tests for schema stability and non-empty catalog.

Files (expected):
- `server/commandRegistry.js`
- `server/index.js`
- `tests/unit/commandCatalog.test.js`

Acceptance:
- Endpoint returns stable JSON schema.
- Voice + Commander parsers can read same catalog object.

---

### PR M0.2 — In-app command browser
Scope:
- Add a read-only command browser panel/modal with search and examples.
- Wire help links from Commander + Voice UI to this browser.

Files (expected):
- `client/app.js`
- `client/styles.css`
- `tests/unit/commanderActionCoverage.test.js` (update expectations if needed)

Acceptance:
- Users can discover every supported command from UI.
- No regressions in existing command handling.

## Milestone M1 — Simple mode shell (Codex/Cursor parity direction)

### PR M1.1 — Add "Simple mode" scaffold
Scope:
- Add top-level mode switch: `Simple` and `Advanced`.
- Keep current UI as Advanced unchanged.
- Simple mode displays:
  - left rail: projects
  - project pane: chats/threads list
  - main pane: active thread status + launch actions

Files (expected):
- `client/index.html`
- `client/app.js`
- `client/styles.css`
- `client/workspace-tab-manager.js`

Acceptance:
- Mode state persists in user settings.
- Advanced behavior is unaffected by default.

---

### PR M1.2 — Thread model service
Scope:
- Add local persisted thread records:
  - `threadId`, `workspaceId`, `title`, `worktreeId/path`, `sessionIds`, `status`, `updatedAt`.
- CRUD endpoints:
  - `GET /api/threads`
  - `POST /api/threads`
  - `PATCH /api/threads/:id`
  - `DELETE /api/threads/:id` (soft-delete/archive first)

Files (expected):
- `server/projectThreadService.js` (new)
- `server/index.js`
- `tests/unit/projectThreadService.test.js`

Acceptance:
- Thread records survive restart.
- Thread lifecycle does not orphan session metadata.

---

### PR M1.3 — "New chat" one-click lifecycle
Scope:
- Add unified action:
  1. pick/create worktree
  2. create/start sessions
  3. create thread record
  4. open thread UI
- Provide idempotent behavior for retries (409-safe, no duplicates).

Files (expected):
- `server/sessionManager.js`
- `server/workspaceManager.js`
- `server/index.js`
- `client/app.js`
- tests for idempotency and lifecycle consistency

Acceptance:
- Single action creates a runnable thread from a project.
- Retrying same request does not create duplicate sessions/worktrees.

## Milestone M2 — Review Route speed and density

### PR M2.1 — Review Route dense layout defaults
Scope:
- Enforce dense defaults for review route:
  - fullscreen
  - embedded diff
  - terminals/files/diff visible
  - commits/comments collapsed by default
- Ensure first-item auto-open and reliable next/prev loop.

Files (expected):
- `client/app.js`
- `client/styles.css`

Acceptance:
- Review route starts in one click and is immediately usable without manual toggles.

---

### PR M2.2 — Review data reliability fixes
Scope:
- Ensure files/commits/conversation populate for PR tasks even with partial worktree/session data.
- Resolve known empty-state mismatch conditions and invalid selector edge cases.

Files (expected):
- `server/*review*` services
- `client/app.js`
- unit tests around PR task data loading

Acceptance:
- Known "Files 0 / Commits 0 while PR has changes" regressions are eliminated.

## Milestone M3 — Solo-like process stacks

### PR M3.1 — Service stack manifest schema
Status: Done
Scope:
- Add local manifest schema for workspace services:
  - command, cwd, env refs, restart policy, healthcheck hints.
- Add import/export endpoints and validation.

Files (expected):
- `server/workspaceManager.js`
- `server/workspaceSchemas.js`
- `server/index.js`
- tests for schema validation

Acceptance:
- Workspace can persist and load service stack definitions.
- Shipped in PR #TBD:
  - added `server/workspaceServiceStackService.js` with strict/non-strict normalization for service manifests.
  - added service stack endpoints:
    - `GET /api/workspaces/:id/service-stack`
    - `GET /api/workspaces/:id/service-stack/export`
    - `PUT /api/workspaces/:id/service-stack`
    - `POST /api/workspaces/:id/service-stack/import`
  - added unit coverage in `tests/unit/workspaceServiceStackService.test.js`.

---

### PR M3.2 — Service stack runtime controls
Status: Done
Scope:
- Start/stop/restart-all actions for stack-defined services.
- Crash detection + optional auto-restart policy.
- Surface health states in UI.

Files (expected):
- `server/sessionManager.js`
- `server/statusDetector.js`
- `client/app.js`
- `client/styles.css`
- tests for lifecycle and restart policy

Acceptance:
- Stack behaves as one-click local runtime supervisor.
- Shipped in PR #TBD:
  - added service runtime supervisor service (`server/serviceStackRuntimeService.js`) with desired-state tracking per workspace/service.
  - added runtime APIs:
    - `GET /api/workspaces/:id/service-stack/runtime`
    - `POST /api/workspaces/:id/service-stack/start`
    - `POST /api/workspaces/:id/service-stack/stop`
    - `POST /api/workspaces/:id/service-stack/restart`
  - added auto-restart monitor for `always` / `on-failure` policies and non-restart fallback for `never`.
  - added runtime health status model (`unknown` without healthcheck, `down` when stopped, `up/degraded` when healthchecks configured).
  - added unit coverage in `tests/unit/serviceStackRuntimeService.test.js`.

## Milestone M4 — Automation UX and governance

### PR M4.1 — Cron/workflow templates
Status: Done
Scope:
- Extend scheduler UI with templates:
  - review route sweep
  - stuck session nudge
  - daily health digest
- Add dry-run preview and last-run logs.

Files (expected):
- `server/schedulerService.js`
- `server/index.js`
- `client/app.js`
- tests for template expansion and scheduling payload validation

Acceptance:
- Non-expert users can create useful automations without raw JSON editing.
- Shipped in PR #662:
  - expanded scheduler template catalog with `stuck-session-nudge` and `daily-health-digest`.
  - preserved existing dry-run preview flow (`POST /api/scheduler/jobs/from-template/preview`) and status panel recent-run visibility.
  - validated via `npm run test:unit`, `npm run test:e2e:safe`, and `npm run check:command-surface`.

---

### PR M4.2 — Team/shared config baseline
Status: Done
Scope:
- Add signed/shared manifest option for team-visible defaults.
- Keep private local override layer.

Files (expected):
- `server/configPromoterService.js`
- `server/encryptedStore.js`
- docs and tests

Acceptance:
- Teams can share workflow defaults without leaking private local data.
- Shipped in PR #661:
  - added `server/configPromoterService.js` to promote/attach/resolve team service-stack baselines with shared/encrypted storage and optional signature verification.
  - added `server/encryptedStore.js` reusable AES-256-GCM JSON encrypt/decrypt helpers for shared config artifacts.
  - added team baseline APIs:
    - `GET /api/workspaces/:id/service-stack/team`
    - `POST /api/workspaces/:id/service-stack/team/promote`
    - `POST /api/workspaces/:id/service-stack/team/attach`
    - `DELETE /api/workspaces/:id/service-stack/team`
    - `PUT /api/workspaces/:id/service-stack/local-override`
  - updated service-stack resolution/runtime to apply shared baseline + private local override layering.
  - added unit coverage in `tests/unit/configPromoterService.test.js` and expanded `tests/unit/workspaceServiceStackService.test.js`.

---

### PR M4.3 — Pager/Pollcat automation service
Status: Done
Scope:
- Add first-class pager jobs that can nudge stalled agent sessions (`next` + Enter).
- Implement profile model:
  - default instructions template (global)
  - per-job custom instructions override/append
  - per-target session filter (single session, workspace, tier set)
- Implement safe stop conditions:
  - explicit max pings and max runtime
  - stop on terminal exit/session missing
  - optional done-check prompt: if the agent confirms 100% complete, stop pager service
- Expose controls:
  - `POST /api/pager/jobs` (create/start)
  - `POST /api/pager/jobs/:id/stop`
  - `GET /api/pager/jobs` (status, last ping, failures)
- Wire command surface:
  - Commander/voice actions for start/stop/status
  - UI quick controls in Scheduler/Automation panel

Files (expected):
- `server/pagerService.js` (new)
- `server/index.js`
- `server/commandRegistry.js`
- `client/app.js`
- `tests/unit/pagerService.test.js`

Acceptance:
- Pager can run with only defaults (no custom prompt required).
- Pager can run with custom per-job instructions.
- Pager sends input using the required two-step pattern (`next`, then `\\r`).
- Pager terminates cleanly on done condition or explicit stop command.
- Shipped in PR #662:
  - added global pager defaults under `global.pager` with UI save action and runtime profile merge.
  - added per-job custom instruction mode (`append`/`replace`), workspace targeting, and tier-filtered target selection.
  - extended pager status snapshots with filtered-target and tier metadata.
  - validated via `tests/unit/pagerService.test.js` and full suite checks.

## 5) Cross-platform release gates (each merge)

Required checks before merge:
1. `npm run test:unit`
2. `npm run test:e2e:safe` for impacted flows
3. Windows smoke checks:
   - Commander terminal starts
   - worktree/session lifecycle actions function
   - command catalog endpoint and browser render
4. Linux/WSL smoke checks:
   - same as Windows plus path/cwd correctness

## 6) Dependency-first execution order

1. M0.1, M0.2, M1.1
2. M1.2, M1.3
3. M2.1, M2.2
4. M3.1, M3.2
5. M4.1, M4.2, M4.3

## 7) Explicit non-goals for this phase

- Full plugin runtime isolation framework.
- Mac-specific native packaging work.
- Replacing advanced mode UX.

## 8) Risk register

1. Lifecycle drift between thread/worktree/session states.
   - Mitigation: server-side source-of-truth lifecycle service + idempotent endpoints.
2. UI complexity explosion from dual modes.
   - Mitigation: strict simple-mode scope and feature flag boundaries.
3. Cross-platform command/runtime inconsistencies.
   - Mitigation: enforce Windows + Linux gates on every milestone.

## 9) Tracking updates

Use this file as the source-of-truth execution checklist.
On every merged PR, append:
- PR URL
- merged commit
- pass/fail against acceptance criteria
- follow-up tasks if any
