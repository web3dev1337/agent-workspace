# Phase 4/5 Execution Tickets from Competitive Analysis

Date: 2026-02-07
Source baseline: competitive analysis in PR `#634` (`COMPETITIVE_ANALYSIS_SOLOTERM_CODEX_CLAUDE_AND_OTHERS_2026-02-07.md`)

## Goal

Convert competitive gap findings into an execution-ready backlog with acceptance criteria, risk, and sequencing for shipping a market-ready local-first AI orchestration product.

## Scope assumptions

- Keep advanced orchestrator workflows intact (no regressions in Queue/Review Console/workspace-worktree-session flows).
- Additive changes first; destructive migrations only after explicit sign-off.
- Windows + Linux parity required for every shipped ticket.

## Ticket legend

- Priority: `P0` (critical), `P1` (high), `P2` (medium)
- Size: `S` (<1 day), `M` (1-3 days), `L` (3-7 days)
- Status: `Done`, `Ready`, `Blocked`, `Later`

---

## P0 Tickets (critical)

### P0-01: One-command onboarding diagnostics and auto-fix
- Status: Done
- Size: M
- Why: competitors win on time-to-first-value
- Deliverables:
  - new endpoint `GET /api/diagnostics/first-run`
  - checks for `git`, `gh`, `claude`, `codex`, `node-pty`, repo scan health, ports, auth
  - fix suggestions and one-click repair actions where safe
- Acceptance criteria:
  - fresh machine can run diagnostics in <10s
  - all blocking prerequisites reported in one view
  - at least 3 high-frequency setup failures have one-click repair
- Shipped in PR #TBD:
  - added `POST /api/diagnostics/first-run/repair-safe` for bulk safe repairs from first-run diagnostics.
  - added Settings → Diagnostics button `Auto-fix safe issues` wired to run safe repairs and refresh check state.
  - added unit coverage for bulk safe repair flow (`runFirstRunSafeRepairs`).

### P0-02: Lifecycle consistency for workspace/worktree/session close/remove
- Status: Done
- Size: M
- Why: avoid orphaned terminals/sessions and stale recovery entries
- Deliverables:
  - single lifecycle policy matrix in code + docs
  - explicit behavior for:
    - close terminal process
    - remove worktree from workspace
    - close thread
    - archive thread
  - synchronized cleanup across session manager + recovery store + queue references
- Acceptance criteria:
  - closing/removing actions leave no stale active sessions
  - session recovery only shows truly recoverable sessions
  - unit coverage for all lifecycle transitions
- Shipped in PR #TBD:
  - added explicit lifecycle policy module + `GET /api/lifecycle/policy`.
  - tightened worktree removal matching to avoid false positives (`work1` no longer matches `work10`).
  - synchronized remove-worktree cleanup with linked thread status/session references.
  - added lifecycle policy unit tests for parsing/matching/default behavior.

### P0-03: Review Route dense layout defaults (throughput mode)
- Status: Done
- Size: M
- Why: review throughput is core differentiator
- Deliverables:
  - new `throughput` preset in Review Console
  - default to embedded diff in route mode
  - reduced vertical waste + side-by-side terminal pairing guarantees
- Acceptance criteria:
  - no page-level vertical scroll at 1440p for standard PRs
  - route mode opens directly into diff-dominant layout
  - explicit keyboard flow: next/approve/changes/merge without mouse-heavy navigation
- Shipped in PR #TBD:
  - added `throughput` Review Console preset and made Review Route apply it by default.
  - added diff-first throughput grid layout tuning and paired terminal side-by-side enforcement.
  - added Review Console PR action controls + keyboard flow (`Alt+Shift+N/A/C/M`) for next/approve/changes/merge.

### P0-04: Voice/Commander parity for simple Projects+Chats workflow
- Status: Done (PR #635)
- Size: S
- Deliverables shipped:
  - command `project-chats-new`
  - client action handler to create chat from command surface
  - voice parsing for `open projects and chats` and `new chat` phrases
  - tests updated

---

## P1 Tickets (high)

### P1-01: Simple mode left-rail polish to Codex-style ergonomics
- Status: Done
- Size: M
- Deliverables:
  - faster thread switching and preloading
  - pinned recent threads
  - quick project/thread search
- Acceptance criteria:
  - thread open action <300ms perceived latency on warm cache
  - keyboard-only flow works for project select + chat open + new chat
- Shipped in PR #TBD:
  - added project and thread search inputs in Projects + Chats shell.
  - added pinned and recent thread ordering with per-thread pin/unpin controls.
  - added background preloading of workspace thread lists for faster project switches.

### P1-02: Capability contract generation (single source for UI/voice/commander/help)
- Status: Done
- Size: M
- Deliverables:
  - generated command manifest artifact from registry
  - startup validation that client action handlers cover all commander actions
  - docs/help surfaces generated from manifest
- Acceptance criteria:
  - adding a command updates discovery/help without manual sync work
  - CI fails on command/action drift
- Shipped in PR #TBD:
  - Added `scripts/check-command-surface-drift.js` to verify `server/commandRegistry.js` commander actions are all handled in `client/app.js`.
  - Added `npm run check:command-surface`.
  - Added CI enforcement in `.github/workflows/tests.yml` and `.github/workflows/windows.yml`.

### P1-03: Plugin SDK v1 hardening
- Status: Done
- Size: M
- Deliverables:
  - `plugins/` schema + versioned manifest
  - plugin capability constraints (routes/commands/surfaces)
  - plugin compatibility checks at startup
- Acceptance criteria:
  - invalid plugin manifests fail with clear diagnostics
  - plugin command namespace collisions are prevented
- Shipped in PR #TBD:
  - `server/pluginLoaderService.js` now validates manifest schema/version (`manifestVersion: 1`), id/path safety, capabilities, and compatibility constraints.
  - plugin command registration now enforces namespace/collision checks and per-plugin command caps.
  - tests added for invalid manifest version, command collisions, and command-cap overflow.

### P1-04: Scheduler UX templates expansion (cron skills)
- Status: Done
- Size: M
- Deliverables:
  - richer template library (review sweep, blockers triage, health snapshots, discord queue cadence)
  - schedule dry-run preview
  - audit log linking to run outcomes
- Acceptance criteria:
  - non-technical user can create safe schedule without editing raw JSON
  - blocked dangerous commands surface clear policy reason
- Shipped in PR #TBD:
  - expanded `SchedulerService` template catalog with review/integration/maintenance templates.
  - added shared template build logic + dry-run API path (`/api/scheduler/jobs/from-template/preview`).
  - added Settings preview action to inspect generated schedule id/command/safety before adding.

### P1-05: Public release install UX (Windows-first)
- Status: Done
- Size: M
- Deliverables:
  - installer post-install checks
  - app-level “fix environment” wizard
  - better `gh`/auth guidance and actionable copy
- Acceptance criteria:
  - setup success rate improved for first-time Windows users
  - support checklist reduced to one guided flow
- Shipped in PR #TBD:
  - added install wizard diagnostics model (`collectInstallWizard`) that presents ordered blocking/warning setup steps.
  - added install wizard endpoints (`/api/diagnostics/install-wizard`, `/api/diagnostics/post-install`) for one guided post-install flow.
  - added diagnostics UI actions for `Post-install check` + `Fix environment wizard` and rendered actionable step summaries in the existing panel.
  - added unit coverage for install wizard output/actions in `tests/unit/diagnosticsService.test.js`.

---

## P2 Tickets (medium)

### P2-01: Competitor telemetry benchmark dashboard
- Status: Later
- Size: S
- Deliverables:
  - local metrics comparing onboarding/runtime/review cycle-time over releases
  - export snapshot for release notes

### P2-02: Team governance pack
- Status: Later
- Size: L
- Deliverables:
  - richer policy templates by role/persona
  - shareable org policy bundles
  - signed audit exports for compliance workflows

### P2-03: Client plugin surface (post-modularization)
- Status: Later
- Size: L
- Deliverables:
  - modular client extension points
  - plugin UI slots and lifecycle APIs
- Note: defer until `client/app.js` modularization reaches safe threshold.

---

## Execution order (recommended)

1. P0-01 onboarding diagnostics
2. P0-02 lifecycle consistency
3. P0-03 review throughput layout
4. P1-01 simple-mode polish
5. P1-02 capability contract generation
6. P1-04 scheduler template UX
7. P1-03 plugin SDK hardening
8. P1-05 windows install UX
9. P2 items after above baseline

## Definition of done for this plan

- Every `Ready` ticket has:
  - endpoint/UI files identified
  - test targets identified
  - measurable acceptance criteria
- Track implementation in PR-sized slices and update this file status per ticket.
