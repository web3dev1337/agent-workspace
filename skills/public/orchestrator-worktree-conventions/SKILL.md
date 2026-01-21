---
name: orchestrator-worktree-conventions
description: Project folder + git-worktree conventions for Agent Orchestrator. Use when creating a new project under ~/GitHub, converting an existing repo into a master/workN worktree layout, adding worktrees, choosing safe ports, or when the orchestrator needs to infer project/worktree paths from the folder structure.
---

# Orchestrator Worktree Conventions

## Overview

This skill defines the **standard directory layout** and **worktree naming conventions** used by Agent Orchestrator so agents can reliably create, find, and manage projects/worktrees.

## Quick Rules

- **Never edit the user’s run-only orchestrator instance:** avoid `/home/<user>/GitHub/tools/automation/claude-orchestrator/master` (it’s used on port 3000). Do all orchestrator dev work in `.../claude-orchestrator-dev`.
- Prefer the **worktree layout**: each project has a stable `master/` folder plus multiple `workN/` folders (e.g., `work1`…`work8`) for parallel work.
- Keep paths deterministic: the orchestrator and scripts should be able to derive category/framework/project/worktree from folder location.

## Standard Directory Layout

Base root: `~/GitHub/`

Typical project path:

`~/GitHub/<category>/<framework>/<project>/<worktree>`

Where `<worktree>` is usually:
- `master` (stable “mainline” checkout)
- `work1`, `work2`, … (parallel dev worktrees)

Examples:
- `~/GitHub/games/hytopia/HyFire2/master`
- `~/GitHub/games/hytopia/HyFire2/work1`
- `~/GitHub/websites/<project>/master`

Some categories may have “ungrouped” projects directly under the category folder; treat them as valid and don’t force nesting.

For more examples, see `references/layout.md`.

## Creating a New Project (Recommended Path)

Prefer using the orchestrator’s **Greenfield Wizard** (UI) so the repo is created consistently and worktrees are initialized correctly.

When asked to “create a new project”, gather:
- Desired category + framework (games/hytopia, games/monogame, websites, tools, writing, etc.)
- Project name
- Whether it should be worktree-structured immediately (default: yes)
- Any known default port (avoid 3000; prefer 4000+ for local dev services)

## Adding a New Worktree

Preferred workflow:
- Use the orchestrator UI to add a worktree to the active workspace.
- Name it with the next available number (e.g., if you have `work1..work3`, create `work4`).

## Ports (Safety)

- Do not use port **3000** in this dev worktree (reserved for the user’s run-only orchestrator).
- For orchestrator tests use `npm run test:e2e:safe` (Playwright will use port **4001**).
- For ad-hoc local dev services, prefer ports **4000+** and avoid collisions with other running projects.

## References

- Folder/worktree examples: `references/layout.md`
