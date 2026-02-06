# Codex parity gap analysis (2026-02-06)

Purpose: analyze what Codex app workflows provide today, map that to current orchestrator capabilities, and define concrete parity gaps.

---

## 1) Official-source baseline (Codex app)

From official OpenAI docs:
- Codex app launched on **February 2, 2026** and is available for ChatGPT Plus/Pro/Team users.
- The UI emphasizes a left-navigation model with:
  - `Projects` and per-project `Threads` (chats)
  - `Tasks` and a review queue/workstream
- Core workflow primitives include:
  - project-level setup (`notes`, `setup script`)
  - async task execution in isolated environments
  - review queue actions (`approve`, `request changes`, `push changes`)
  - automations with schedule/event triggers
  - command palette + keyboard shortcuts

Official references:
- https://developers.openai.com/codex/changelog/
- https://developers.openai.com/codex/codex-app/overview/
- https://developers.openai.com/codex/codex-app/review/
- https://developers.openai.com/codex/codex-app/automations/
- https://developers.openai.com/codex/codex-app/worktrees/
- https://developers.openai.com/codex/codex-app/commands/

---

## 2) Current orchestrator baseline

Current strengths (already implemented):
- Multi-workspace + workspace tabs:
  - `client/workspace-tab-manager.js`
  - `server/workspaceManager.js`
- Multi-session orchestration with agent/server terminals:
  - `client/app.js` terminal grid + review console
  - `server/sessionManager.js`
- Rich review queue + review console:
  - `client/app.js` (`showQueuePanel`, `openReviewConsoleForPRTask`)
- Voice + Commander semantic command model:
  - `server/commandRegistry.js`
  - `/api/commander/capabilities`, `/api/commander/execute`, `/api/commander/execute-text`
- Scheduler foundation:
  - `server/schedulerService.js`
  - `/api/scheduler/*`

---

## 3) Parity matrix (Codex model vs orchestrator)

| Codex capability | Current orchestrator equivalent | Gap | Priority | Complexity |
|---|---|---|---|---|
| Left sidebar: Projects + Threads | Workspaces + sessions + dashboard | No first-class `thread` abstraction; UX is workspace-first, not chat-first | P0 | M |
| “New thread/chat” per project | Add mixed worktree + start agent/session | No single “new chat” action that encapsulates worktree/session lifecycle | P0 | M |
| Project-scoped setup/notes | Workspace config + prompts + metadata | Not a unified “project profile” object with setup notes/scripts in one obvious surface | P1 | M |
| Task/review route loop | Queue + Review Console + Review Route buttons | Powerful but still split across multiple controls; needs simplified “single-screen route mode” | P0 | M |
| Review queue actions in-context | Queue detail + PR merge/review actions | Mostly present; needs denser defaults and stronger “next task” ergonomics | P1 | S |
| Async automations | Scheduler service | Needs “cron skills” templates and human-friendly authoring UI | P0 | M |
| Command palette/shortcuts discoverability | Commander commands + hotkeys + voice commands | No unified user-facing command catalog page/API contract for all clients | P0 | S |
| Per-project task history model | Task records + telemetry + session recovery | Not centered around “project threads”; history is session/task centric | P1 | M |
| Simple mode + advanced mode split | Advanced mode exists | Missing explicit “Simple mode” shell that hides low-level controls | P0 | M/L |
| Provider abstraction (Claude/Codex + future) | Claude + Codex paths implemented | Needs stricter provider-neutral interface for future third provider | P1 | M |

---

## 4) Highest-impact gaps to close first

### Gap A: No first-class `thread/chat` entity

Why it matters:
- Codex-style UX is chat-first.
- Orchestrator is terminal/worktree-first.

Needed:
- Introduce persisted `thread` metadata under a workspace/project:
  - thread id
  - linked worktree id/path
  - primary agent session id
  - title/status/last activity

### Gap B: No one-click “new chat”

Why it matters:
- Current flow requires multiple operations (create/add worktree, start agent, bind metadata).

Needed:
- One endpoint/command to:
  1) choose/create worktree
  2) create linked sessions
  3) create thread record
  4) open chat/review context

### Gap C: Command discoverability is fragmented

Why it matters:
- Voice fallback, commander text parsing, and UI controls should all read from one command contract.

Needed:
- Unified command catalog endpoint with structured metadata:
  - command id
  - params schema
  - provider applicability
  - safety level
  - UI/voice labels + examples

### Gap D: Scheduler is low-level, not user-level “cron skills”

Why it matters:
- Existing JSON scheduler is functional but not approachable.

Needed:
- Templates + wizards:
  - review route sweep
  - stuck-task nudge
  - status digest
  - ticket sync checks

---

## 5) Recommended product direction

Keep both interaction layers:
- `Simple mode` (Codex-style):
  - projects
  - chats
  - task route panel
  - scheduled automations
- `Advanced mode` (current orchestrator):
  - full terminal grid
  - deep queue controls
  - explicit workspace/worktree/session operations

This avoids regression for power users while making onboarding easier.

---

## 6) Architecture implications

Server additions:
- `projectThreadService` (new)
- `threadLifecycleService` (new)
- `commandCatalogService` (new or commandRegistry extension)

Client additions:
- left rail model: project/thread navigation component
- thread pane (chat-first)
- mode switch (`simple` vs `advanced`)

Data model:
- thread records under user config (`~/.orchestrator/...`)
- mapping:
  - `thread -> workspaceId`
  - `thread -> worktreePath/worktreeId`
  - `thread -> session ids`

---

## 7) Risks

- UX duplication risk if simple and advanced modes diverge too far.
- Lifecycle confusion risk if thread close/remove semantics are ambiguous.
- Complexity risk if we add client plugins before modularizing `client/app.js`.

Mitigations:
- strict lifecycle contract
- explicit mode boundaries
- phase client modularization before pluginized UI surface

---

## 8) Decision outcome

Recommendation:
- Proceed with parity program.
- Prioritize:
  1) unified command catalog
  2) thread model + new chat lifecycle
  3) simple-mode shell
  4) cron-skills UX layer

Next file:
- `PLANS/2026-02-06/CODEX_PARITY_IMPLEMENTATION_PLAN.md`

