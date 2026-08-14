# Plan (living doc — updated as scouts report)

## Key discovery (before scouts)
Most of the tier/queue/review vision ALREADY EXISTS (built Jan-Feb 2026, PRs #179-#275+):
- taskRecordService (tier/changeRisk/pFailFirstPass/verifyMinutes/promptRef/deps/review outcomes/telemetry timestamps) → `~/.orchestrator/task-records.json`
- processTaskService (Queue = PRs + ready worktrees + waiting sessions), processStatusService (WIP + B/W/Q/X banner), processAdvisorService, processPairingService, processTelemetryService, prReviewAutomationService (auto reviewer/fixer/recheck spawn), worktreeTagService, pullRequestService, commandRegistry + voiceCommandService (queue-* commands)
- Queue panel + Review Console + PRs panel + Review Route + conveyor T2/T3 + workflow modes (Focus/Review/Background/All) in client/app.js
- Prompt artifacts (private/shared/encrypted) + promotion
- MOSTLY HIDDEN via ui.visibility defaults in user-settings.default.json (open-source simplification)
- PLANS/2026-02-21/REVIEW_QUEUE_WORKFLOW_REPORT.md recommends consolidation into single "Review Hub" — never implemented (verify)

## Implementation phases (one PR, commit per phase)
1. **Docs**: this ai-memory + PLANS/2026-07-15/ design doc (write after scout synthesis).
2. **Evidence system (NEW — the centerpiece)**:
   - Evidence manifest convention agents write in worktree (JSON + media folder)
   - server/evidenceService.js: discover/parse/validate manifests; merge into queue task detail
   - Schema: tests{}, appRun{}, reviews[](role/model/verdict/fixes), media[], data[], diffStats, handoffNotes, standards
   - docs/agents/EVIDENCE_PROTOCOL.md + prompt-injectable template so agents self-report (+ self-orchestrated review chains)
   - Queue detail Evidence card UI (at-a-glance checklist: tests ✅ ran ✅ reviews 2/2 ✅ media 📸 data 📊)
3. **Review Hub consolidation** (Feb 21 report recs): single Review Hub entry; workflow-visibility PRESET toggle ("Simple" vs "Process/Power" mode) that flips the hidden flags in one click instead of 30 individual toggles.
4. **Workflow chains / prompt library**: config/review-workflows.json — data-driven role chains (security/perf/general reviewer, fixer) with per-role model/effort/prompt template, per-risk chain length; wire into existing spawn actions; record per-stage results.
5. **Context freshness**: promptSentAt age tracking → "cache cold (>55m): reprompt in fresh window" warning + handoff-notes flow.
6. **Context-switch telemetry (local)**: log workspace/worktree/panel/review focus switches to ~/.orchestrator JSONL + summary endpoint + advisor hook.
7. **Commander**: fix `/clear` not working; multi-commander if seam is small (else document).
8. **Plugins**: verify pipeline works; ship example plugin (YouTube transcript button) if wiring sound.
9. Tests (unit for new services + e2e safe where cheap), CODEBASE_DOCUMENTATION.md update, PR.

## Verify before merge
- node --check on touched server files; npm run test:unit; targeted e2e safe.
- Never touch ~/GitHub/tools/automation/claude-orchestrator/* (running prod).
