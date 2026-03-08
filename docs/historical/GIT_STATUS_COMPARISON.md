# Git Status Comparison Report

Generated: 2026-01-09

## Quick Summary

| Instance | Branch | Ahead of main | Open PR | PR Status | Uncommitted Changes |
|----------|--------|---------------|---------|-----------|---------------------|
| **Dev** (`claude-orchestrator-dev`) | `fix/workspace-grid-layout` | 4 commits | #65 | UNKNOWN | 2 files |
| **Master** (`master`) | `fix/terminal-grid-sizing` | 1 commit | #67 | MERGEABLE | 2 files |

**Common Ancestor:** Both branches are based on `bfedf16` (current `origin/main`)

---

## Dev Instance Details (`claude-orchestrator-dev`)

### Branch: `fix/workspace-grid-layout`

**Commits ahead of main (4):**
| SHA | Message |
|-----|---------|
| a52ad7d | fix: restore missing UI state management functions from master |
| 27748f1 | fix: prevent media queries from overriding data-visible-count grid layout |
| b7a7154 | debug: add comprehensive logging for grid layout investigation |
| 1d617db | fix: ensure terminal grid layout is updated when switching workspaces |

**Uncommitted Changes:**
| File | Status | Changes |
|------|--------|---------|
| `package.json` | Modified | +1 line |
| `package-lock.json` | Modified | +50 lines |

**Untracked Files:**
- `debug-grid.js` (debug script)
- `grid-debug.png` (debug screenshot)

**Stashes (2):**
- `stash@{0}`: WIP on fix/terminal-grid-layout
- `stash@{1}`: From fix/diff-cache-error

**PR #65 Status:**
- State: OPEN
- Mergeable: UNKNOWN (may need rebase/refresh)
- Title: "fix: ensure terminal grid layout updates when switching workspaces"

---

## Master Instance Details (`master`)

### Branch: `fix/terminal-grid-sizing`

**Commits ahead of main (1):**
| SHA | Message |
|-----|---------|
| 29d3082 | fix: terminal grid now properly fills available viewport space |

**Uncommitted Changes:**
| File | Status | Changes |
|------|--------|---------|
| `.gitignore` | Modified | +5/-1 lines |
| `package-lock.json` | Modified | +304/-320 lines |

**Untracked Files:**
- `.nvmrc` (Node version file)
- `PROJECT_CREATION_PLAN.md` (planning doc)
- `inspect-layout.js` (debug script)

**Stashes (2):**
- `stash@{0}`: WIP on fix/terminal-grid-layout
- `stash@{1}`: From fix/diff-cache-error

**PR #67 Status:**
- State: OPEN
- Mergeable: MERGEABLE
- Merge State: CLEAN (ready to merge)
- Title: "fix: terminal grid now properly fills available viewport space"

---

## All Open PRs (8 total)

| PR | Title | Branch | Status | Date |
|----|-------|--------|--------|------|
| #67 | fix: terminal grid now properly fills available viewport space | `fix/terminal-grid-sizing` | MERGEABLE | 2025-12-29 |
| #66 | fix: isWorktreeInUse now checks actual sessions | `fix/worktree-in-use-check` | OPEN | 2025-12-26 |
| #65 | fix: ensure terminal grid layout updates when switching workspaces | `fix/workspace-grid-layout` | UNKNOWN | 2025-11-05 |
| #64 | fix: terminal grid layout broken in tab system | `fix/terminal-grid-layout` | OPEN | 2025-10-27 |
| #63 | feat: Windows one-click launcher scripts | `feature/windows-launcher-scripts` | OPEN | 2025-10-27 |
| #56 | fix: prevent existing terminals from resetting | `fix/worktree-reset-bug` | OPEN | 2025-10-09 |
| #55 | fix: correct method name destroySession to terminateSession | `fix/worktree-delete-terminatesession` | OPEN | 2025-10-09 |
| #49 | fix: prevent Claude spinner duplication | `feature/spinner-fix` | OPEN | 2025-10-01 |

---

## Recommendations

### Immediate Actions

1. **PR #67 is ready to merge** - Master instance's branch is clean and mergeable
   - Merge this first to get the terminal grid sizing fix into main

2. **PR #65 needs attention** - Dev instance's branch shows UNKNOWN mergeable status
   - May need rebase onto latest main after PR #67 merges

3. **Clean up debug artifacts** - Both instances have debug files that shouldn't be committed:
   - Dev: `debug-grid.js`, `grid-debug.png`
   - Master: `inspect-layout.js`, `PROJECT_CREATION_PLAN.md`

### Related PRs (Grid Issues)
These PRs all address terminal grid layout issues and may overlap:
- #67: Terminal grid fills viewport (READY)
- #65: Grid layout on workspace switch
- #64: Grid layout broken in tab system

**Consider:** Review if #65 and #64 are still needed after #67 merges, or if they should be rebased/consolidated.

### Stale PRs
These PRs are 3+ months old and may need review:
- #56, #55, #49 (from October 2025)

---

## Current `origin/main` State

Latest commits on main:
```
bfedf16 Merge pull request #62 from web3dev1337/fix/analyze-pr-issue
ee39322 fix: Restore tabs on page refresh (F5)
29c2bdc docs: Remove incorrect workspace persistence bug documentation
6045e82 Merge pull request #61 from web3dev1337/feature/tabbed-workspaces
```

Both dev and master instances are based on this same commit (`bfedf16`).
