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
