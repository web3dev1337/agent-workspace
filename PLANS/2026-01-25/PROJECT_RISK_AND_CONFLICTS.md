# Project Risk + Conflict Detection (Orchestrator-native)

Goal: make “what’s safe to run/merge/review” visible in the orchestrator without requiring a Trello card.

This separates:

1) **Impact Risk (project/base risk)** – how bad if something breaks in this repo.
2) **Change Risk (task/PR risk)** – how risky the specific change is.
3) **pFailFirstPass** – chance the agent won’t get it right first try (reprompt/manual fix needed).

This PR adds the foundation for (1) and a minimal conflict detector for parallel work.

---

## Storage (source of truth)

### A) Shared/team-visible (recommended)

Add a `project` section to `.orchestrator-config.json` in the repo (or at a parent folder like `~/GitHub/games/hytopia/.orchestrator-config.json`):

```json
{
  "project": {
    "baseImpactRisk": "high",
    "isLive": true,
    "prodUrl": "https://example.com",
    "displayName": "HyFire2",
    "aliases": ["Voxfire"]
  }
}
```

Supported `baseImpactRisk` values: `low | medium | high | critical`.

These configs **cascade** from `~/GitHub/...` down to the project root, so a parent config can set defaults for a whole framework/category.

### B) Local/private overrides (per-user)

Create `~/.orchestrator/project-metadata.json`:

```json
{
  "version": 1,
  "defaults": { "baseImpactRisk": "low" },
  "projects": {
    "games/hytopia/games/HyFire2": { "baseImpactRisk": "high", "aliases": ["Voxfire"] },
    "games/hytopia/zoo-game": { "baseImpactRisk": "medium" },
    "games/monogame/epic-survivors": { "baseImpactRisk": "high" }
  }
}
```

Keys are **paths relative to** `~/GitHub` (portable across machines with the same folder layout).

Precedence:

1) defaults
2) cascaded `.orchestrator-config.json` `project` blocks
3) `~/.orchestrator/project-metadata.json` exact match override

---

## API

### Worktree metadata includes project risk

`GET /api/worktree-metadata?path=...`

Now returns:

- `git` (branch, dirty counts, ahead/behind)
- `pr` (if any)
- `project` (baseImpactRisk + sources)

`POST /api/worktree-metadata/batch` also includes `project`.

### Project metadata endpoints

- `GET /api/project-metadata?path=...`
- `POST /api/project-metadata/batch` with `{ paths: [...] }`

### Conflict detection (minimal)

`POST /api/worktree-conflicts` with `{ paths: [...] }`

Detects conflicts within the same project:

- `file-overlap`: overlapping changed files between two worktrees
- `parallel-prs`: two worktrees in same project both have PRs
- `parallel-uncommitted`: two worktrees in same project both dirty

This is intentionally conservative; it’s a “heads up” signal, not proof of merge conflict.

---

## UI (initial)

Quick-worktree menu shows a `risk: <level>` suffix and color strip (right border) via:

- `.quick-menu-item.risk-low|risk-medium|risk-high|risk-critical`

---

## Next steps (ties into tier workflow)

1) Add task/PR-level `changeRisk` + `pFailFirstPass` and compute `overallRisk`.
2) Add a “Review Inbox” view sorted by `overallRisk` and “time to verify”.
3) Use conflict API to warn when two tiered tasks overlap in a repo.

