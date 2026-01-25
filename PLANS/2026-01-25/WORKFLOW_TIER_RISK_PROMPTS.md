# Workflow: Tiers + Risk + Prompts (Resume-Safe Status)

Purpose: if context is lost, this is the **single file** that states what we decided, what is shipped, what is missing, and what to do next.

Date: 2026-01-25

---

## PR Index (for resume)

- Trello Tasks (kanban + writes): https://github.com/web3dev1337/claude-orchestrator/pull/179
- Tasks parity (labels + custom fields editing): https://github.com/web3dev1337/claude-orchestrator/pull/180
- Project risk + bounded conflicts: https://github.com/web3dev1337/claude-orchestrator/pull/181
- Docs (resume-safe workflow status): https://github.com/web3dev1337/claude-orchestrator/pull/182
- Task records API (tier/risk/promptRef): https://github.com/web3dev1337/claude-orchestrator/pull/183
- Prompt artifacts (local/private): https://github.com/web3dev1337/claude-orchestrator/pull/184
- Queue (review inbox v0): https://github.com/web3dev1337/claude-orchestrator/pull/185
- Tier filters + badges: https://github.com/web3dev1337/claude-orchestrator/pull/186
- Remove “optional” wording: https://github.com/web3dev1337/claude-orchestrator/pull/187
- Orchestrator-native dependencies: https://github.com/web3dev1337/claude-orchestrator/pull/188
- Workflow modes + Queue Next/Prev: https://github.com/web3dev1337/claude-orchestrator/pull/189

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
  - fast filter buttons: All/Q1/Q2/Q3/Q4/None
  - tier badge shown on sidebar worktree rows

What’s still needed:
- scheduling/automation rules (e.g. auto-hide Q3/Q4 while Tier 1 is busy)
- “review conveyor belt” UX expansion (mark reviewed, request changes, launch fix agent)

Roadmap reference: `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`

### ✅ Shipped (workflow modes)

Header includes:
- **Focus** (Tier 1–2)
- **Review** (all tiers; opens Queue)
- **Background** (Tier 3–4)

Queue includes:
- **Prev/Next** navigation with unblocked items ordered first.

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
- Trello embed endpoint (pointer/snippet/full/chunks)

Still needed:
- “promote private → shared/encrypted” workflow + UI

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

---

## Checklist (to keep us honest)

- [x] Tier tagging exists (task records for PR/worktree/session)
- [x] Tier-aware visibility rules exist (focus + review modes)
- [x] changeRisk + pFailFirstPass + verifyMinutes stored per task
- [x] Review Inbox exists and drives diff viewer
- [x] Prompt artifacts exist (private; shared/encrypted WIP)
- [x] Dependency model extends beyond Trello when no card exists
