# Workflow: Tiers + Risk + Prompts (Resume-Safe Status)

Purpose: if context is lost, this is the **single file** that states what we decided, what is shipped, what is missing, and what to do next.

Date: 2026-01-25

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

### ❌ Missing (orchestrator-native dependencies)

We still need dependencies for:
- greenfield/T4 tasks with **no Trello card**
- cross-entity dependencies (PR ↔ PR, branch ↔ ticket, worktree ↔ ticket)
- a blocked/unblocked overview / graph view

---

## Tiers (Tier 1/2/3/4)

### ❌ Not shipped yet

Tier is an **orchestrator/agent workflow concept**, not purely a Trello concept:
- a tiered task may have no ticket,
- tiers can change (e.g. T4 exploration → T1 focus).

What’s needed:
- tier tagging for worktrees/PRs/sessions
- tier-aware UI: show/hide based on focus and “review mode”
- a “Review Inbox / Batch Review” workflow that drives the diff viewer + checklists

Roadmap reference: `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`

---

## Prompt artifacts (massive prompts; private vs shared)

### Decision

Trello comments are not a durable source of truth for large prompts.

We will support **prompt artifacts**:
- Local/private (default): `~/.orchestrator/prompts/<taskId>.md`
- Shared (team): committed prompt file in repo (or a shared “worklog” repo)
- Encrypted shared (optional): commit encrypted (sops/age/git-crypt)

If a Trello card exists:
- post a short Trello comment pointing to the artifact (PR/commit + path), not the full prompt

### ❌ Not shipped yet

We still need:
- storage + API for prompt artifacts and task records
- UI workflow to “promote private → shared”

---

## Project/base risk metadata

### ✅ Shipped (PR open)

PR: https://github.com/web3dev1337/claude-orchestrator/pull/181

Adds project-level base impact risk metadata with optional local overrides, and exposes it via:
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

### ❌ Missing (future, optional)

If we later want ticket↔ticket “conflict probability”, it should be a heuristic layer on top of:
- file overlap in PR diffs
- shared hotspots (lockfiles, infra, auth, etc.)
- project context distance

---

## Open PRs (as of 2026-01-25)

- PR #180 (open): Tasks: Trello parity (labels + custom fields editing)
  - https://github.com/web3dev1337/claude-orchestrator/pull/180
- PR #181 (open): Project risk metadata + conflict detection
  - https://github.com/web3dev1337/claude-orchestrator/pull/181

---

## Next recommended PRs (small, shippable)

1) **Task record store (orchestrator-native)**
   - Store: tier, changeRisk, pFailFirstPass, verifyMinutes, promptRef, linked ticket/PR/worktree
   - Support local-only by default; allow share later
2) **Review Inbox (v0)**
   - list “ready for review” items (PRs + tagged worktrees)
   - open diff viewer + show checklist
3) **Prompt artifacts**
   - create/edit prompt artifact
   - optional “post pointer comment to Trello”

---

## Checklist (to keep us honest)

- [ ] Tier tagging exists (worktree/PR/session)
- [ ] Tier-aware visibility rules exist (focus + review modes)
- [ ] changeRisk + pFailFirstPass + verifyMinutes stored per task
- [ ] Review Inbox exists and drives diff viewer
- [ ] Prompt artifacts exist (private/shared)
- [ ] Dependency model extends beyond Trello when no card exists

