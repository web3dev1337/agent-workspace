# Progress

- [x] Branch created from origin/main @ affdc657; PR not yet opened (open at end)
- [x] Research: 6 sonnet scouts; digests saved in scratchpad /digests/*.md (framework, specs, impl, plugins, tiercode; commander scout never reported — pinged, then did commander work myself)
- [x] Design doc PLANS/2026-07-15/EVIDENCE_REVIEW_WORKFLOWS_PLAN.md (commit c85fcf92)
- [x] Phase 2: fix reviewer/batch spawn bugs (agentId/flags/two-write submit/repoName session id) + tests (530f7383)
- [x] Phase 3: task record `evidence` field + normalizer + tests (2fa27a34)
- [x] Phase 4: evidenceService (PR body/comments fenced blocks + worktree file + diffStats + safe media endpoint) + routes + tests (b504b7b7)
- [x] Phase 5: Queue evidence card UI (client/queue-evidence.js + css + renderDetail wiring) (85e2bb7f)
- [x] Phase 6: review workflows — config/review-workflows.json, reviewWorkflowService (chain runner, GitHub-verdict polling, evidence.reviews recording, stall/blocked states), agentSpawnHelper extraction, claude --model support, queue workflow block UI + routes + tests (73c9c2f2)
- [x] Phase 7: docs/agents/EVIDENCE_PROTOCOL.md + evidencePromptSnippet auto-injected into batch launch prompts + tests (8228021b)
- [x] Phase 8: visibility presets Simple/Power + Settings "UI Mode" section + un-hid queue button ("📥 Review" hub) + tests (33a066ee)
- [x] Phase 9: prompt-cache freshness — fresh-window fixer (implements stubbed autoSpawnFixer), 🧊 cache-cold chip + tests (1665e198)
- [x] Phase 10: context-switch telemetry service + client hooks (workflow mode/worktree focus/workspace switch/review timers) + dashboard telemetry overlay line + tests (14c0f819)
- [x] Phase 11a: commander /clear fix — captured slash cmds were sent as one "/text\r" paste chunk; now two writes (1aafc943)
- [ ] Phase 12: plugins — example youtube-transcript plugin, post_route action type, commander.tools slot renderer, plugin admin in Settings, README client.slots docs
- [ ] Phase 13 (stretch): play buttons revival (uncomment app.js:4537-4555 area, wire getDynamicLaunchOptions, {{gameMode}}/{{commonFlags}} substitution)
- [ ] Phase 11b: multi-commander — write feasibility/seam note in PLANS (commanderService = hard singleton w/ one PTY); implement only if small
- [ ] Phase 14: CODEBASE_DOCUMENTATION.md update, full test suite, gh pr create (PR URL in final reply!)

## Key facts for resume
- Worktree node_modules installed (npm ci done). npm run test:unit green (620+ tests). Never touch ~/GitHub/tools/automation/claude-orchestrator/* (running prod, port 4000).
- Smoke-test servers: use random port 55xx, NOT 3000/4000; task records live at ~/.agent-workspace/task-records.json (I once wrote+removed task:smoke).
- Evidence sources merge order: existing record → PR blocks → worktree file; worktreePath is server-set only (agent blocks stripped); media served only from within that root.
- Commit style: type: subject + body + Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>. Push after every commit.
