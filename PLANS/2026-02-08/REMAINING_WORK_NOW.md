# Remaining work now (as of 2026-02-08)

This file is the canonical short list after syncing the Phase 5 execution plan and merged PR tracking.

## Actionable non-destructive work

- None currently open in the tracked M0-M4 execution slices.
- Execution status is synced in `PLANS/2026-02-08/COMPETITIVE_GAP_EXECUTION_PLAN.md`.
- One-command verification report:
  - `npm run report:release-readiness`
  - Optional artifacts:
    - `npm run report:release-readiness -- --json-out /tmp/release-readiness.json --md-out /tmp/release-readiness.md`
  - Optional strict history scan:
    - `npm run report:release-readiness -- --include-history`
  - Snapshot quality check only:
    - `npm run check:public-snapshot-repo`
  - Includes git identity guardrails:
    - effective git email must be GitHub noreply
    - global git email should be GitHub noreply
    - canonical-history custom-email warnings are elevated only in `--include-history` mode

## Remaining destructive / optional work

- None required for the current release-readiness target.
- The non-destructive “single-commit public snapshot repo” path is now implemented and executed.
- Optional follow-up (only if desired): rewrite canonical repository history in-place using the guarded executor and strict checks.

## Notes on scanner noise

Several generated scan docs still show "remaining markers" because they include:
- template checklists
- historical "next steps" prose
- scan files scanning other scan files

Those are not active implementation backlog unless explicitly promoted into a new execution plan.

## Last merged sequence for closure

- #662 — pager defaults + tier-target filtering
- #663 — mark M4 automation milestones complete
- #664 — REST thread lifecycle aliases (`POST/PATCH/DELETE /api/threads`)
- #665 — sync M0-M4 milestone statuses with shipped PRs
- #666 — append merged PR tracking updates in the Phase 5 plan
- #667 — canonical remaining-work snapshot
- #668 — history author audit tooling
- #669 — rewrite execution-prep workkit generator
- #670 — rewrite readiness preflight gate
- #671 — rewrite tool bootstrap helper
- #672 — one-command rewrite prep pipeline
- #673 — post-rewrite result verifier
- #674 — mailmap finalize helper
- #675 — persisted prep report artifacts
- #676 — guarded rewrite executor
- #677 — public snapshot repo generator
- #678 — docs sync for release readiness closure
- #679 — one-command release-readiness report
- #680 — snapshot verifier + report integration
- #681 — git identity guardrails in release-readiness report
- #682 — Review Console richer ticket move picker (list-name-forward labels with Current/Done/For Test tags)
- #683 — voice/commander queue selection by PR number + optional repo hint (`select pr 492 in zoo-game`)
- #684 — docs sync: queue PR-number selection helper marked completed in Phase 4 remaining-work snapshot
- #685 — docs sync: commander typed freeform parse route marked completed (`/api/commander/execute-text`)
- #686 — provider-agnostic agent provider API surface (`server/agentProviderService.js` + `/api/agent-providers/*` + plugin service wiring)
- #687 — docs sync: provider interface foundation reflected in remaining-work tracking
- #688 — lifecycle close/remove consistency pass for paired worktree sessions (tab close + destroy + clear paths)
- #689 — review-console pairing stability across providers (Codex agent + server pairing/order paths)
- #690 — Codex parity in agent workflows (tiering/view filters/thread focus/GitHub link detection)
- #691 — docs sync: remaining-work log refreshed through PR #690
- #692 — review console defaults to throughput diff-first preset
- #693 — diff viewer hides zero-value add/delete counters (`+0`/`-0`)
- #694 — docs sync: remaining-work scan and shipped PR refs backfilled (`#648-#658`)
- #695 — docs sync: append PR #694 in merged-sequence closure log
- #696 — docs sync: remaining-work references aligned through PR #695
- #697 — scanner output-mode hardening (`scan-markdown-remaining` JSON mode + tests)
- #698 — docs sync: remaining-work references aligned through PR #697
- #699 — scanner actionable-only mode (`--actionable-only`) + generated-scan classification
- #700 — docs sync: remaining-work history through PR #699
- #701 — strict actionable scan filtering (exclude heuristic-only prose from `--actionable-only`)
- #702 — docs sync: remaining-work history through PR #701
- #703 — actionable scan classifier refinement (exclude guide/audit/memory docs)
- #704 — docs sync: remaining-work history through PR #703
- #705 — docs sync: remaining-work history through PR #704
- #706 — backlog-only markdown scan mode (`--backlog-only`) + docs/tests
