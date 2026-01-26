# Workflow: Tiers + Risk + Prompts (Resume-Safe Status)

Purpose: if context is lost, this is the **single file** that states what we decided, what is shipped, what is missing, and what to do next.

Date: 2026-01-25
Last updated: 2026-01-27

---

## Brain dump (2026-01-25)

The full transcript is preserved in:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`

The implementation plan derived from it is:
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/DATA_MODEL.md`

## PR Index (for resume)

- Trello Tasks (kanban + writes): https://github.com/web3dev1337/claude-orchestrator/pull/179
- Tasks parity (labels + custom fields editing): https://github.com/web3dev1337/claude-orchestrator/pull/180
- Project risk + bounded conflicts: https://github.com/web3dev1337/claude-orchestrator/pull/181
- Docs (resume-safe workflow status): https://github.com/web3dev1337/claude-orchestrator/pull/182
- Task records API (tier/risk/promptRef): https://github.com/web3dev1337/claude-orchestrator/pull/183
- Prompt artifacts (local/private): https://github.com/web3dev1337/claude-orchestrator/pull/184
- Queue (review inbox v0): https://github.com/web3dev1337/claude-orchestrator/pull/185
- Tier filters + badges: https://github.com/web3dev1337/claude-orchestrator/pull/186
- Docs: remove ambiguous language: https://github.com/web3dev1337/claude-orchestrator/pull/187
- Orchestrator-native dependencies: https://github.com/web3dev1337/claude-orchestrator/pull/188
- Workflow modes + Queue Next/Prev: https://github.com/web3dev1337/claude-orchestrator/pull/189
- Process status banner (WIP + T1–T4): https://github.com/web3dev1337/claude-orchestrator/pull/193
- Launch gating (prompt on overload): https://github.com/web3dev1337/claude-orchestrator/pull/194
- Finish next-phase workflow checklist: https://github.com/web3dev1337/claude-orchestrator/pull/223
- Docs: commit/push discipline: https://github.com/web3dev1337/claude-orchestrator/pull/224
- Tasks: 1-click launch from kanban cards (UX): https://github.com/web3dev1337/claude-orchestrator/pull/226
- Tasks: board view full-width until card selected (UX): https://github.com/web3dev1337/claude-orchestrator/pull/228
- Tasks: show Trello board color in toolbar (UX): https://github.com/web3dev1337/claude-orchestrator/pull/230
- Tasks: quick launch defaults in toolbar (UX): https://github.com/web3dev1337/claude-orchestrator/pull/232
- Tasks: 1-click tier launch buttons on board cards (UX): https://github.com/web3dev1337/claude-orchestrator/pull/234
- Tasks: list view 1-click tier launch (UX): https://github.com/web3dev1337/claude-orchestrator/pull/236
- Tasks: toolbar default tier is 1-click buttons (UX): https://github.com/web3dev1337/claude-orchestrator/pull/238
- Tasks: toolbar agent/mode are 1-click buttons (UX): https://github.com/web3dev1337/claude-orchestrator/pull/240
- Tasks: quick launch in “All enabled boards” view (UX): https://github.com/web3dev1337/claude-orchestrator/pull/242
- Tasks: all-boards card detail launch uses card boardId (UX): https://github.com/web3dev1337/claude-orchestrator/pull/244
- Tasks: show per-card board color dots (UX): https://github.com/web3dev1337/claude-orchestrator/pull/246
- Status lights: stabilize worktree/agent busy/waiting detection: https://github.com/web3dev1337/claude-orchestrator/pull/248
- Tasks board view: detail overlay on right (prevents kanban reflow): https://github.com/web3dev1337/claude-orchestrator/pull/250

## Known UX issues / follow-ups

- (none currently tracked from the 2026-01-27 UX notes)

---

## What we mean by “risk”

We use **two risk dimensions** (plus an uncertainty metric):

1) **Impact risk (project/base risk)**: how bad if something breaks in this repo.
2) **Change risk (task/PR risk)**: how risky the specific change is (scope, migrations, auth, etc.).
3) **pFailFirstPass**: probability the agent won’t get it right first try (reprompt/manual fix needed).

These are separate:
- a safe repo can have a risky change,
- a risky repo can have a safe change,
- a low-risk change can still have high pFail if the prompt is underspecified.

---

## Dependencies (ticket linking)

### ✅ Shipped (Trello-backed)

Dependencies are represented in Trello via a **Checklist named `Dependencies`** on a card.

- Team sharing: native Trello collaboration (source of truth is the Trello card).
- UI: shown + editable in the Tasks card detail panel (add/remove/toggle).
- API for humans/agents:
  - `GET /api/tasks/cards/:cardId/dependencies?provider=trello`
  - `POST /api/tasks/cards/:cardId/dependencies?provider=trello`
  - `DELETE /api/tasks/cards/:cardId/dependencies/:itemId?provider=trello`
  - `PUT /api/tasks/cards/:cardId/dependencies/:itemId?provider=trello`

### ✅ Shipped (orchestrator-native dependencies)

Dependencies also exist for tasks with **no Trello card** via orchestrator task records.

- Stored in `~/.orchestrator/task-records.json` under `dependencies: string[]`
- Supported IDs (v1): `pr:owner/repo#num`, `worktree:/abs/path`, `session:<id>`
- Satisfaction rules (v1):
  - `doneAt` marks any dependency satisfied
  - PR dependencies are satisfied when GitHub reports the PR is **merged**
- UI: Queue shows `deps:X blocked:Y` and a dependencies editor.
- API for humans/agents:
  - `GET /api/process/task-records/:id/dependencies`
  - `POST /api/process/task-records/:id/dependencies`
  - `DELETE /api/process/task-records/:id/dependencies/:depId`

---

## Tiers (Tier 1/2/3/4)

### ✅ Partially shipped

Tier is an **orchestrator/agent workflow concept**, not purely a Trello concept:
- a tiered task may have no ticket,
- tiers can change (e.g. T4 exploration → T1 focus).

What’s shipped (as of 2026-01-25):
- Task record storage (local) supports `tier`, `changeRisk`, `pFailFirstPass`, `verifyMinutes`, `promptRef`
  - API: `GET|PUT /api/process/task-records/:id`
- Review Inbox v0 (“📥 Queue”) for process tasks (PR/worktree/session)
  - edit tier/risk/pFail/verify/promptRef
  - open prompt editor and diff viewer
- Tier filters + badges (sidebar + terminal grid)
  - fast filter buttons: All/T1/T2/T3/T4/None
  - tier badge shown on sidebar worktree rows

What’s still needed:
- scheduling/automation rules (e.g. auto-hide T3/T4 while Tier 1 is busy)
- “review conveyor belt” UX expansion (mark reviewed, request changes, launch fix agent)

Roadmap reference: `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`

### ✅ Shipped (workflow modes)

Header includes:
- **Focus** (Tier 1–2)
- **Review** (all tiers; opens Queue)
- **Background** (Tier 3–4)

Queue includes:
- **Prev/Next** navigation with unblocked items ordered first.
- Review controls (one-by-one workflow):
  - Tier scope buttons (All/T1/T2/T3/T4/None)
  - `Unreviewed`, `Auto Diff`, and `Start Review`
- Focus includes a Tier-2 gating toggle:
  - `T2 Auto` hides Tier 2 while Tier 1 is busy
  - `T2 Always` always shows Tier 2 in Focus

---

## Worktrees (capacity helpers)

### ✅ Shipped: auto-create `work9+` when busy

If all existing worktrees are busy and the UI cannot find a recommended worktree, the UI can auto-create a new worktree (bounded) and then proceed with the normal “add-worktree-sessions” flow.

Settings (local, `user-settings.json`):
- `global.ui.worktrees.autoCreateExtraWhenBusy` (default `true`)
- `global.ui.worktrees.autoCreateMinNumber` (default `9`)
- `global.ui.worktrees.autoCreateMaxNumber` (default `25`)
- `global.ui.worktrees.considerOtherWorkspaces` (default `true`, uses stronger “in use” heuristic across workspaces)
- Focus includes an auto-swap toggle:
  - `Swap T2` shows Tier 2 only while Tier 1 is busy (auto-returns when Tier 1 is idle)

---

## Prompt artifacts (massive prompts; private vs shared)

### Decision

Trello comments are not a durable source of truth for large prompts.

We will support **prompt artifacts**:
- Local/private (default): `~/.orchestrator/prompts/<taskId>.md`
- Shared (team): committed prompt file in repo (or a shared “worklog” repo)
- Encrypted shared: commit encrypted (sops/age/git-crypt)

If a Trello card exists:
- post a short Trello comment pointing to the artifact (PR/commit + path), not the full prompt

### ✅ Shipped

Shipped:
- Prompt artifacts API (local/private):
  - `GET /api/prompts`, `GET|PUT|DELETE /api/prompts/:id`
  - default storage: `~/.orchestrator/prompts/<id>.md`
- Shared/encrypted prompt storage (repo-backed):
  - `GET|PUT /api/prompts/:id?visibility=shared|encrypted&repoRoot=/abs/repo&relPath=path/to/prompt.md`
  - Encrypted operations require `ORCHESTRATOR_PROMPT_ENCRYPTION_KEY` (preferred) or `ORCHESTRATOR_PROMPT_PASSPHRASE`
- Promotion endpoint (private → shared/encrypted):
  - `POST /api/prompts/:id/promote` body `{ visibility: "shared"|"encrypted", repoRoot, relPath? }`
- Queue UI supports store selection (`private|shared|encrypted`) + promote flow.
- Trello embed endpoint (pointer/snippet/full/chunks)

---

## Project/base risk metadata

### ✅ Shipped (merged to `main`)

Adds project-level base impact risk metadata with local override support, and exposes it via:
- `GET /api/worktree-metadata?path=...` (includes `project.baseImpactRisk`)
- `POST /api/worktree-metadata/batch`
- `POST /api/worktree-conflicts` (minimal conflict signals)

How to configure:
- shared: add `project` block to `.orchestrator-config.json` in repo (or parent folders)
- local: `~/.orchestrator/project-metadata.json`

User-provided defaults:
- HyFire2 (aka Voxfire): high
- Epic Survivors: high
- Zoo: medium

---

## Ticket-level conflicts (combinatorial explosion)

### ✅ Shipped (minimal, bounded)

We do **not** attempt full ticket↔ticket conflict computation.
Instead we provide a cheap, bounded signal for parallel work in the same project:
- file overlap (uncommitted)
- parallel PRs
- parallel dirty worktrees

Endpoint: `POST /api/worktree-conflicts`

### ❌ Missing (future work)

If we later want ticket↔ticket “conflict probability”, it should be a heuristic layer on top of:
- file overlap in PR diffs
- shared hotspots (lockfiles, infra, auth, etc.)
- project context distance

---

## Next recommended PRs (small, shippable)

1) **Prompt artifact promotion**
   - private → shared/encrypted + pointer comment policy (Trello)
2) **Review workflow expansion**
   - mark reviewed, request changes, launch fix agent
3) **Automation rules**
   - e.g. hide Tier 3/4 while Tier 1 busy; simple launch gating

## Added follow-ups from the brain dump (shipped)

These were explicitly requested in the 2026-01-25 brain dump.

### ✅ Shipped in this branch (work/continue-2026-01-25e)

1) **Board ↔ repo/path mapping**
   - Stored in user settings: `global.ui.tasks.boardMappings` (key: `${provider}:${boardId}`)
   - UI: Tasks toolbar → ⚙ “Board Settings”
   - Fields: `enabled`, `localPath`/`relativePath`, `repoSlug`, `defaultStartTier`
   - Settings merge is safe for partial `ui.tasks` updates (doesn’t drop `kanban`/`filters` defaults)

2) **Hidden/disabled boards**
   - Board mapping supports `enabled=false`
   - Disabled boards are hidden from the board selector by default
   - UI: Board Settings → “Show disabled boards”

3) **Launch agent from Trello card**
   - Tasks card detail includes a “Launch Agent” block (tier + agent + mode + YOLO + auto-send prompt)
   - Uses board mapping + repo scanner + recommended worktree selection
   - Emits `add-worktree-sessions` with `startTier`, then auto-starts agent and can auto-send prompt when session becomes `waiting`

4) **Dependency viewer UX (v1)**
  - Queue detail shows:
    - Dependencies (resolved list: satisfied/blocked + reason)
    - Dependents (“unblocks” list from local task records)
  - Queue detail also includes:
    - “Pick from queue…” for fast dependency linking
    - “🧩 Graph” modal (bounded depth) for upstream/downstream trees

5) **Second-agent review lane (manual, v1)**
  - Queue detail for PR items includes a “Reviewer” action to spawn a reviewer agent in a clean/available worktree.
  - Intended for Tier 3 PRs to reduce first-pass failure rate before merge.

6) **Telemetry (v1)**
   - Task records now store:
     - `reviewStartedAt` / `reviewEndedAt`
     - `promptSentAt` / `promptChars` (best-effort)
   - Queue detail shows telemetry and supports a manual review timer (Start/Stop) and auto-timing when “Start Review” is enabled.
   - API summary: `GET /api/process/telemetry`

7) **Advisor (v1)**
  - API: `GET /api/process/advice` returns actionable recommendations (uses status + telemetry + task records).
  - UI: Commander panel → “Advice” button shows the advisor overlay.

8) **Commander + voice workflow controls (v1)**
  - Commander-executable commands:
    - `set-workflow-mode` (`focus|review|background`)
    - `set-focus-tier2` (`auto|always`)
    - `open-queue`, `open-tasks`, `open-advice`
  - Voice rules now recognize phrases like:
    - “enter focus mode”, “review mode”, “background mode”
    - “tier 2 auto / tier two always”, “show tier twos”
    - “open queue”, “open tasks”, “open advice”
  - UX fix: typing manually in a `*-claude` terminal suppresses the Fresh/Continue/Resume startup overlay (prevents it popping up when you run `claude ...` by hand).

9) **Review conveyor belt (expanded, v1)**
  - Queue detail includes:
    - Notes / fix request field (`record.notes`)
    - “🛠 Fixer” action that spawns a fixer agent for the PR and auto-sends a fix prompt (stores `fixerSpawnedAt` / `fixerWorktreeId`)
    - “🔒 Claim” / “🔓 Release” to lock an item while reviewing (stores `claimedBy` / `claimedAt`)
    - “🔁 Recheck” action to spawn a reviewer after fixes (stores `recheckSpawnedAt` / `recheckWorktreeId`)
  - Optional automation:
    - “Auto Reviewer” toggle spawns a reviewer agent automatically for unreviewed Tier 3 PRs (stores `reviewerSpawnedAt` / `reviewerWorktreeId`)

10) **Trello PR-merge automation (v1)**
  - When enabled, the server can auto-comment (and optionally move/close) a Trello card when a linked PR is merged.
  - Link methods:
    - Set `ticketCardId`/`ticketCardUrl` on the PR task record (Queue → “Ticket (Trello)” field), or
    - Include a Trello card URL (or `trello:<shortLink>`) in the PR description so the server can infer it.
  - Settings (local, `user-settings.json`):
    - `global.ui.tasks.automations.trello.onPrMerged.enabled` (default `false`)

11) **Notification modes (v1)**
  - Settings (local, `user-settings.json`):
    - `global.ui.workflow.notifications.mode` (`quiet` | `aggressive`)
    - `global.ui.workflow.notifications.tier1Interrupts` (toast when Tier 1 queue appears)
    - `global.ui.workflow.notifications.reviewCompleteNudges` (toast when stopping review timer)

12) **Dependency graph (v3)**
  - Unifies orchestrator-native dependencies + Trello dependencies in one bounded graph.
  - Graph modal now supports:
    - Trello nodes (opens in Trello via Ctrl/Cmd+Click)
    - Focus/drilldown by clicking nodes (re-roots the graph)
    - Pinning + pinned-node selector
    - Filtering (hide satisfied edges)
    - Cycle detection indicator (best-effort)
  - Queue dependencies editor improvements:
    - bulk add (comma/newline)
    - quick-search via datalist suggestions
    - import ticket “Dependencies” checklist into task record deps

13) **Advisor (v2) + coach dashboard (v2)**
  - Advice endpoint now includes metrics + richer recommendations using:
    - telemetry trends + review outcomes (needs_fix rate, stuck timers)
    - dependency blocked signals (Tier 1/2 blockers)
  - Dashboard “Process” section surfaces metrics + top advice items.

### Optional future work (nice-to-have)

None currently tracked from the 2026-01-25 brain dump.

---

## Checklist (to keep us honest)

- [x] Tier tagging exists (task records for PR/worktree/session)
- [x] Tier-aware visibility rules exist (focus + review modes)
- [x] changeRisk + pFailFirstPass + verifyMinutes stored per task
- [x] Review Inbox exists and drives diff viewer
- [x] Prompt artifacts exist (private/shared/encrypted + promotion)
- [x] Dependency model extends beyond Trello when no card exists
- [x] Board ↔ repo/path mapping exists (Tasks → Board Settings)
- [x] Hidden/disabled boards supported
- [x] Launch agent from Trello card supported
- [x] Auto-create `work9+` when all worktrees are busy (bounded; configurable via `global.ui.worktrees`)
- [x] Automated tests exist (unit + E2E safe port)

Test commands:
- `npm run test:unit`
- `npm run test:e2e:safe`
