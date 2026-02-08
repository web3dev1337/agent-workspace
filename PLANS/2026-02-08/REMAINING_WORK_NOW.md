# Remaining work now (as of 2026-02-08)

This file is the canonical short list after syncing the Phase 5 execution plan and merged PR tracking.

## Actionable non-destructive work

- None currently open in the tracked M0-M4 execution slices.
- Execution status is synced in `PLANS/2026-02-08/COMPETITIVE_GAP_EXECUTION_PLAN.md`.

## Remaining destructive / optional work

1. History rewrite or new squashed public repo (intentional separate step)
   - Source: `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`
   - Reason still open: destructive operation, intentionally deferred.
   - Prep available now:
     - `npm run setup:history-rewrite-tools` (non-destructive dependency bootstrap guidance for `git-filter-repo`/`gitleaks`)
     - `npm run prep:history-rewrite:pipeline` (non-destructive one-command prep pipeline: tool check + workkit + preflight)
     - `npm run prep:history-rewrite:mailmap-finalize -- --workkit-dir <dir>` (fills mailmap noreply placeholders from configured/explicit target email)
     - `npm run audit:history-authors` (non-destructive author-email audit + mailmap template output)
     - `npm run prep:history-rewrite` (non-destructive private workkit: runbook + removal-path list + filter-repo helper script)
     - `npm run check:history-rewrite-readiness -- --workkit-dir <dir>` (non-destructive advisory preflight)
     - `npm run check:history-rewrite-readiness:strict -- --workkit-dir <dir>` (non-destructive strict gate for rewrite maintenance window)
     - `npm run check:history-rewrite-result` (post-rewrite strict validator for emails + blocked history paths)

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
