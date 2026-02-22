# Post-Rewrite Local Recovery Plan (2026-02-22)

This document captures the recommended local actions after the full-history rewrite and force-push.
It avoids machine-specific absolute paths; replace `<LOCAL_ROOT>` with your real root (for example, your local `GitHub` directory).

## Summary
- The remote history was rewritten and force-pushed.
- Every local clone based on the old history must be **reset or re-cloned**.
- Any uncommitted local work should be backed up before resetting.

## Universal Commands (Safe Reset)
If you have **no local changes** you need to keep:
```bash
git fetch --all --prune
git checkout main
git reset --hard origin/main
```

If you **do** have local work to keep:
```bash
# Option A: bundle the full local repo state
mkdir -p ~/repo-backups
git bundle create ~/repo-backups/claude-orchestrator-LOCAL.bundle --all

# Option B: patch the delta against origin/main
git format-patch origin/main --stdout > ~/repo-backups/claude-orchestrator-LOCAL.patch

# Then reset
 git fetch --all --prune
 git checkout main
 git reset --hard origin/main
```

## Local Clone Inventory (Recommendations)
Replace `<LOCAL_ROOT>` with your local Git root. The paths below match the known orchestrator clones.

| Local Clone | Current Branch | Recommendation |
| --- | --- | --- |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/master` | `fix/layout-zoom-resilience` | Backup untracked `PLANS/2026-02-10/`, then reset to `origin/main`. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/claude-orchestrator-dev` | `feat/onboarding-first-run` | Reset to `origin/feat/onboarding-first-run` (or rebase onto `origin/main` if needed). |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/work1` | `audit/open-source-readiness-report` | Reset to `origin/audit/open-source-readiness-report`. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/work9` | `work9-dev` | If not needed, reset to `origin/main` or delete/re-clone. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/work-fix-batch-launch` | `main` (behind) | Reset to `origin/main`. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/work-list-header-launch-btn` | `feature/board-list-header-launch-btn` | If branch is still needed, rebase onto `origin/main`; otherwise reset to `origin/main`. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/workclaude-orchestrator-dev` | `workclaude-orchestrator-dev-dev` | If not needed, reset to `origin/main` or delete/re-clone. |
| `<LOCAL_ROOT>/tools/automation/claude-orchestrator/claude-orchestrator-public-snapshot` | `master` (snapshot) | Keep as-is unless you want to regenerate a fresh snapshot from the new `main`. |

## Focused Commands Per Clone
### Production clone (master)
```bash
cd <LOCAL_ROOT>/tools/automation/claude-orchestrator/master
# Move any local notes first if needed
mv PLANS/2026-02-10 /tmp/claude-orchestrator-plans-2026-02-10

git fetch --all --prune
git checkout main
git reset --hard origin/main
```

### Dev clone
```bash
cd <LOCAL_ROOT>/tools/automation/claude-orchestrator/claude-orchestrator-dev
git fetch --all --prune
git reset --hard origin/feat/onboarding-first-run
```

## Aftercare Checklist
1. Close/recreate any open PRs based on old history.
2. Re-run `npm install` if your tooling behaves oddly after the reset.
3. Re-enable branch protections to prevent accidental force-pushes.

## Emergency Recovery
- Private backup repo (full history) is available.
- Local mirror archive exists and can be rehydrated if needed.

