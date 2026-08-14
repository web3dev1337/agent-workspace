---
date: 2026-07-18T02:15:00Z
project: agent-workspace (formerly claude-orchestrator)
---

## Goal
Open-PR sweep (2026-07-18): review all 17 open PRs, fix issues on their branches, merge approved ones into a test branch, deploy for user testing.

## Current State
- All 17 open PRs reviewed via 14-scout swarm; fixes pushed to every approved branch (see PR comments for verdicts).
- Integration branch `integration/pr-test-2026-07-18` (pushed to origin) = origin/main v0.1.22 + 9 merged branches: #1022 (+3 fix commits incl. evidence worktreePath security fix), #1013, #1014, #1016, #1018, #1020, #993, #997, #998 — all with review fixes. 696/696 unit tests green on the merged tree.
- Deployed to ~/GitHub/tools/automation/claude-orchestrator/master on ports 3000 (server) / 2080 (client) / 7655 (diff-viewer). NOTE: shell env inherited from the dev orchestrator overrides .env ports — must start with explicit `ORCHESTRATOR_PORT=3000 CLIENT_PORT=2080 DIFF_VIEWER_PORT=7655 npm start`.
- master/'s pre-existing dirty package-locks preserved on branch `backup/dirty-worktree-2026-07-18`.
- User's live dev instance: ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev on 4000/2081/7656 (main @ v0.1.20, behind). The ~/GitHub/tools/automation/agent-workspace/{master,agent-workspace-dev} copies are an unused half-migration (no .env/node_modules).

## Verdicts (details in PR comments)
- MERGE (fixed): 1013, 1014, 1016, 1018, 1020, 997, 998, 1022, 993
- CLOSE: 788, 791, 796, 831, 843, 992; 1015 superseded by 1014 (its test cherry-picked into 1014)
- REBASE_AND_RECONSIDER: 804 (paste-review-back-to-source-terminal feature is novel; architecture superseded by agentSpawnHelper)

## Next Steps
1. User tests the integration instance; then merge approved PRs individually into main (order: 1022 first, then small ones; 1014 not 1015).
2. Close superseded/stale PRs (user's call).
3. Consider re-implementing #804's paste-back feature fresh; consider deleting the unused agent-workspace/ dir pair or finishing that migration.

## Key Decisions
- 1014 chosen over 1015 (harness-verified: never uses bare worktree key when repo derivable).
- 1016 filter narrowed to idle-hover motion only (clicks/drags/scroll preserved).
- 1018 close (✕) confirms before stopping a running Commander; in multi-commander it stops the active instance via cmdBody().
- 1020 live-model detection switched from substring regex to JSONL line parsing (assistant message.model only) + TTL cache.
- terminal.startServer default flipped to false on the 1022 branch (Power preset enables it).
