# Brain Dump → Implementation Plan (Tiers, Tasks, Dependencies, Risk, Workflow)

Source transcript: `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`.

This file converts the brain dump into **decisions, current status, data model, and shippable PR-sized steps**.

Date: 2026-01-25

---

## 0) Current status (what already exists in the codebase)

### ✅ Tiers (T1–T4)

- Per-task tier storage exists via **task records** (local, not Trello-native).
- Tier UI exists:
  - Per-agent tile tier dropdown (`None/T1–T4`)
  - Sidebar tier filters + badges
  - Workflow modes: **Focus / Review / Background**
- Launch gating exists to prevent overload (tier-aware caps).

Primary status doc: `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md`.

### ✅ Dependencies (linking tasks)

We support dependencies in two places:

1) **Trello-backed dependencies** (team-shared)
   - Convention: checklist named `Dependencies` on a Trello card.
   - UI: editable in Tasks panel card detail.

2) **Orchestrator-native dependencies** (local, for tasks without Trello cards)
   - Stored in `~/.orchestrator/task-records.json` under `dependencies: string[]`.
   - Resolved by rules:
     - `doneAt` → satisfied
     - `pr:owner/repo#num` → satisfied when PR is merged (GitHub state)

### ✅ Prompt artifacts (massive prompts; private-by-default)

- Local prompt artifacts exist and are addressable via API.
- There is an optional “embed into Trello comment” endpoint (chunking supported).

### ✅ Risk (base project risk vs change risk vs pFail)

- `baseImpactRisk` exists per project (shared via `.orchestrator-config.json` with a local override in `~/.orchestrator/project-metadata.json`).
- `changeRisk`, `pFailFirstPass`, `verifyMinutes` exist per task record.

### ✅ Review workflow primitive (“Queue”)

- “📥 Queue” exists and is the place to:
  - view process tasks (PR/worktree/session)
  - edit tier/risk/pFail/verify/promptRef
  - see dependency summary (`deps:X blocked:Y`)
  - open diff viewer

---

## 1) What’s missing vs the brain dump (requirements)

### 1.1 Board ↔ repo ↔ folder mapping (core requirement) ✅ Shipped (this branch)

Brain dump asks:
- “Is there a link between Trello boards and git repos and folders on our computer?”

Current state (implemented):
- Board mappings live in per-user settings:
  - `user-settings.json` → `global.ui.tasks.boardMappings`
  - key: `${provider}:${boardId}`
  - values: `{ enabled, localPath, relativePath, repoSlug, defaultStartTier }`
- UI: Tasks toolbar → ⚙ “Board Settings”
  - `localPath` accepts absolute paths and `~/GitHub/...`
  - `relativePath` accepts GitHub-relative paths like `games/hytopia/zoo-game`

### 1.2 “Launch agent from Trello card” (one-click task → worktree → agent) ✅ Shipped (this branch)

Brain dump asks:
- Start an agent from a Trello card, pick an available worktree (or create work9+), sync with latest main/master, optionally auto-send the prompt (card description).

Current state (implemented):
- Tasks card detail includes a “Launch Agent” block:
  - tier selector + agent selector (Claude/Codex) + mode + YOLO + auto-send prompt
- Launch flow:
  - card → board mapping → `/api/workspaces/scan-repos` → recommended worktree
  - emits `add-worktree-sessions` with `startTier`
  - when sessions arrive: starts the agent and (optionally) auto-sends the prompt when the session becomes `waiting`

### 1.3 Hidden/disabled boards (reduce noise + API load) ✅ Shipped (this branch)

Brain dump asks:
- hide boards like “Website articles”, and avoid pulling their cards unless re-enabled.

Current state (implemented):
- Board mappings support `enabled=false`.
- Disabled boards are hidden in the board selector by default (except the currently-selected board).
- Board Settings includes a “Show disabled boards” toggle to temporarily reveal them.

### 1.4 Dependency viewer UX (fast linking + hierarchy)

Brain dump asks:
- quickly link dependencies between tasks and view a hierarchy/graph.

Current state:
- Queue already supports dependency editing and resolved dependency display (satisfied/blocked + reason).
- Queue detail now also shows **Dependents** (“unblocks” list) based on local task records.
- ✅ Multi-level dependency viewer now exists:
  - “🧩 Graph” modal renders upstream (“Blocked By”) and downstream (“Unblocks”) trees up to a selectable depth.
  - “Pick from queue…” dropdown enables faster linking without typing IDs.

Outcome:
- Add a dependency viewer:
  - v1: tree list (“blocked by …” / “unblocks …”)
  - v2: graph visualization (optional)

### 1.5 Telemetry + advisor loops

Brain dump asks:
- track prompting time, review time, failure rate / rework rate, and surface recommendations.

Current state:
- Logging exists.
- ✅ Telemetry v1 now exists:
  - Auto prompt send timestamps for sessions
  - Review timers stored per task record + visible in Queue
  - API summary endpoint: `GET /api/process/telemetry`
- ✅ Advisor v1 now exists:
  - API: `GET /api/process/advice`
  - UI: Commander panel “Advice”

Outcome:
- Implement telemetry in small steps and expose it to Commander/voice endpoints as “advice”.

### 1.7 Commander/voice workflow controls ✅ Shipped (this branch)

Brain dump asks:
- hook workflow controls up to Commander Claude + voice commands (focus mode, show tier twos, review queue, etc.)

Current state (implemented):
- Server command registry adds process commands:
  - `set-workflow-mode` (`focus|review|background`)
  - `set-focus-tier2` (`auto|always`)
  - `open-queue`, `open-tasks`, `open-advice`
- Voice rules recognize common phrases and map them to those commands.
- Client handles `commander-action` events to apply mode changes and open panels.

### 1.6 “Second-agent review” (reduce failure risk for Tier 3)

Brain dump asks:
- an additional agent to review Tier 3 work/PRs.

Current state:
- Queue exists; Commander exists.
- Queue now supports a **manual “Reviewer” spawn** for PR tasks (v1), which starts a reviewer agent in a clean/available worktree and auto-sends a review prompt.

Outcome:
- Add an opt-in “spawn reviewer” action (initially manual, later automated).

---

## 2) Data model (where the data lives)

This is the “source of truth” layout.

### 2.1 Entities and IDs

- **Project**: a local repo folder (or a category root).
- **Repo**: a GitHub repo slug (`owner/repo`) and/or local path.
- **Workspace**: orchestrator workspace config (`~/.orchestrator/workspaces/*.json`).
- **Worktree**: git worktree folder (`.../work1`, `.../work2`, etc.).
- **Session**: a running agent terminal session (server-managed).
- **Task**: unified item in Queue (`pr:*`, `worktree:*`, `session:*`, future: `trello:*`).
- **Ticket**: external provider task (Trello card).
- **PromptArtifact**: a stored long prompt (local by default).

### 2.2 Storage locations

- **Task records** (tier/risk/pFail/verify/promptRef/dependencies):
  - file: `~/.orchestrator/task-records.json`
  - service: `server/taskRecordService.js`

- **Orchestrator-native dependencies**:
  - stored inside the task record: `dependencies: string[]`
  - resolver: `server/taskDependencyService.js`

- **Trello dependencies**:
  - stored on card as checklist named `Dependencies`
  - provider impl: `server/taskProviders/trelloProvider.js`

- **Prompt artifacts**:
  - file: `~/.orchestrator/prompts/<id>.md`
  - endpoints: `GET|PUT /api/prompts/:id`

- **Project base risk**:
  - shared: `.orchestrator-config.json` (cascades)
  - local override: `~/.orchestrator/project-metadata.json`

- **Workflow/UI settings**:
  - file: `user-settings.json` (local)
  - service: `server/userSettingsService.js`

---

## 3) Plan: shippable PRs (recommended order)

### PR A — Docs + data model diagram (this file + references)

- Add this plan file and a simple data model doc.
- Ensure `CLAUDE.md` points to the resume-safe workflow status + this plan + the transcript.

### PR B — Board mapping (Trello board → repo/path/workspace) ✅ Done (this branch)

Implemented:
- Default settings include `global.ui.tasks.boardMappings: {}`.
- Tasks panel supports per-board settings + mapping editor.
- Tests:
  - E2E: `tests/e2e/tasks-board-mapping.spec.js`

### PR C — Hide/disable boards ✅ Done (this branch)

Implemented as part of Board Settings:
- disabled boards hidden by default
- “Show disabled boards” toggle to reveal

### PR D — Launch agent from Trello card ✅ Done (this branch)

Implemented:
- Card detail includes “Launch Agent” UI wired to socket + repo scanning.
- No new server endpoint required for v1; it uses `add-worktree-sessions` and existing agent start routines.
- Tests:
  - E2E: `tests/e2e/tasks-launch-from-card.spec.js`

### PR E — Dependency viewer (v1)

- In Queue: show a dependency detail pane:
  - resolved list (satisfied/blocked + reason)
  - “reverse deps” (tasks that depend on this one) when available

### PR F — Telemetry v1 (prompt/review timers)

- Track:
  - prompt start/end timestamps per task/session
  - review start/end timestamps per task
- Store best-effort in task records.
- Expose in `/api/process/task-records/:id`.
  - Also exposed as a lightweight summary: `GET /api/process/telemetry`

### PR G — Second-agent review lane (manual trigger)

- Add “Spawn Reviewer” button for Tier 3 tasks:
  - starts a new session in a clean worktree (or same repo)
  - loads PR diff viewer link + asks reviewer to validate

---

## 3.1) Automated tests (required)

We keep automated coverage for core workflow primitives and any new task-layer features:

- Unit tests: `npm run test:unit`
- E2E tests (safe port): `npm run test:e2e:safe`
  - Targeted: `npm run test:e2e:safe -- tests/e2e/tasks-board-mapping.spec.js`
  - Targeted: `npm run test:e2e:safe -- tests/e2e/tasks-launch-from-card.spec.js`

---

## 4) “Have we done everything?” quick checklist (brain dump)

- [x] Tier system exists (T1–T4 tagging + UI + workflow modes)
- [x] Dependencies exist (Trello checklist + orchestrator-native deps)
- [x] Risk metadata exists (base + change + pFail + verify minutes)
- [x] Prompt artifacts exist (local/private; Trello embed available)
- [x] Board ↔ repo/path mapping exists
- [x] Launch agent from Trello card exists
- [x] Disabled boards list exists
- [x] Automated tests exist (unit + targeted e2e)
- [x] Dependency viewer/graph exists (Queue tree + modal)
- [x] Telemetry loop v1 exists (prompt/review timing + summary endpoint)
- [x] Second-agent review automation exists (Queue “Auto Reviewer” toggle for Tier 3 PRs)
