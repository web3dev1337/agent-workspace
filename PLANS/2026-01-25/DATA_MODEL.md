# Data Model (Projects, Workspaces, Tasks, Tickets)

This is the “one page” model behind tiers, workflow modes, dependencies, and prompt artifacts.

Date: 2026-01-25

---

## Entities (high level)

- **Project**: a local repo folder (often a git repo root).
- **Repo**: GitHub repo slug (optional) + local path (primary in practice).
- **Workspace**: a named set of worktrees/sessions in Agent Orchestrator.
- **Worktree**: a git worktree directory (e.g. `work1`, `work2`, …).
- **Session**: a running agent terminal (Claude/Codex/etc.).
- **Task**: a unified “thing to do/review” in Queue (PR/worktree/session today; tickets later).
- **Ticket**: external task object (Trello card today).
- **TaskRecord**: local metadata keyed by task id (tier/risk/etc.).
- **Dependency**: a link “A is blocked by B”.
- **PromptArtifact**: stored large prompt (private by default).

---

## IDs (conventions)

- PR task: `pr:<owner>/<repo>#<number>`
- Session task: `session:<id>`
- Worktree task: `worktree:<absPath>`
- Trello card (ticket): `trello:<cardId>` (provider-side; can be wrapped into a task later)

---

## Storage (where things live)

- Workspaces: `~/.orchestrator/workspaces/*.json`
- Task records: `~/.orchestrator/task-records.json`
- Prompt artifacts: `~/.orchestrator/prompts/<id>.md`
- Project base risk (shared): `.orchestrator-config.json` (cascades up folders)
- Project base risk (local override): `~/.orchestrator/project-metadata.json`
- Trello credentials: env (`TRELLO_API_KEY`, `TRELLO_TOKEN`) or `~/.trello-credentials`
- UI settings: `user-settings.json`

---

## Relationship diagram (Mermaid)

```mermaid
flowchart LR
  subgraph LocalMachine["Local Machine"]
    Repo["Repo (local path)"]
    Project["Project (folder/repo root)"]
    Workspace["Workspace (~/.orchestrator/workspaces/*.json)"]
    Worktree["Worktree (git worktree dir)"]
    Session["Session (PTY/terminal)"]
    TaskRecord["TaskRecord (~/.orchestrator/task-records.json)"]
    Prompt["PromptArtifact (~/.orchestrator/prompts/<id>.md)"]
  end

  subgraph External["External Systems"]
    Trello["Trello Board/Card"]
    GitHub["GitHub PR"]
  end

  Project --> Repo
  Workspace --> Worktree
  Worktree --> Session

  Session -->|produces| GitHub

  GitHub -->|is a| TaskIdPR["Task ID: pr:owner/repo#num"]
  Session -->|is a| TaskIdSession["Task ID: session:<id>"]
  Worktree -->|is a| TaskIdWorktree["Task ID: worktree:<absPath>"]

  TaskRecord --> TaskIdPR
  TaskRecord --> TaskIdSession
  TaskRecord --> TaskIdWorktree

  TaskRecord -->|references| Prompt
  TaskRecord -->|dependencies[]| Dep["Dependency IDs (string)"]

  Trello -->|ticket| TicketId["Ticket ID: trello:<cardId>"]
  TicketId -. optional mapping .-> Project
```

---

## Where dependencies come from

1) **Trello-backed**: checklist named `Dependencies` on a card (team-shared).
2) **Orchestrator-native**: `TaskRecord.dependencies[]` (local; works even without Trello).

---

## Where tiers live

- Tier is stored in the task record: `TaskRecord.tier` (1–4 or unset).
- Tier is a workflow concept; it can exist without a Trello card.

