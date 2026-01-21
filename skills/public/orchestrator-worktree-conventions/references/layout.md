# Folder Layout Examples

Agent Orchestrator expects projects to live under `~/GitHub/` and to commonly use a git-worktree layout:

```
~/GitHub/<category>/<framework>/<project>/
  master/
  work1/
  work2/
  ...
```

## Categories and Frameworks

The first 1–2 path segments typically indicate the “bucket”:

- `games/` → game projects (often with a framework subfolder like `hytopia/` or `monogame/`)
- `websites/` (or `web/`) → web apps/sites
- `tools/` → internal tooling, automations
- `writing/` → writing/publishing projects

Not all categories require a framework folder. Some projects may be “ungrouped” directly under the category.

## Concrete Examples

### Hytopia game

```
~/GitHub/games/hytopia/HyFire2/
  master/
  work1/
  work2/
```

### Website without a framework folder

```
~/GitHub/websites/education-platform/
  master/
  work1/
```

### Tools project

```
~/GitHub/tools/some-cli-tool/
  master/
  work1/
```

## Worktree Naming

- The stable worktree is named `master/` (even if the git default branch is `main`).
- Development worktrees are named `workN/` and typically correspond to branches `workN`.
- Prefer creating the next-numbered worktree to avoid conflicts (e.g., create `work4` if `work1..work3` exist).

## Ports

- Avoid port **3000** (reserved for the user’s main orchestrator instance).
- Prefer ports **4000+** for local dev servers and tests.
- Orchestrator E2E tests run with `ORCHESTRATOR_TEST_PORT=4001` via `npm run test:e2e:safe`.

