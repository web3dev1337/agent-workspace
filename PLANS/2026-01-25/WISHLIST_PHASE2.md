# Phase 2 Wishlist (Post Brain Dump Shipping)

Last updated: 2026-01-27

This is the “bigger than PR-sized” wishlist after the 2026-01-25 brain dump core shipped.

Source context:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/REMAINING_NEXT_PHASE.md` (now 100% complete)

Process discipline:
- Small PRs; run tests; commit + push + merge continuously.
- Work only in the dev worktree (do not touch the separate `/master` worktree checkout).

---

## Workflow v2 (Focus / Review / Background)

- [ ] “Conveyor” mode for Review: one-at-a-time Tier 2 queue + explicit “Next” affordances (minimize decision fatigue).
- [ ] Stronger “Review complete” feedback loop: per-task nudges, sound/desktop options, and auto-open next item when configured.
- [ ] “Background” mode improvements: triage queue + auto-scheduling rules (e.g., tiered retries, safe backoff).

## Advisor / Coach v2 (recommendations)

- [ ] Expand advisor inputs: dependencies + telemetry + risk + verifyMinutes + reviewOutcome history.
- [ ] Add “project readiness” checklists (playtest / launch / domain / hosting / security) as templates and/or heuristics.
- [ ] Commander/voice hooks to consume advice: “what should I do next?”, “show blockers”, “start next review”.

## Dependency graph v2 (UX)

- [ ] Richer dependency graph UI: timeline-ish “blocked by / unblocks” flow, better satisfaction reasons, and quick edits.
- [ ] Multi-board dependency normalization: show Trello + PR + local deps together with consistent icons and links.

## Tasks v2 (multi-board)

- [ ] Multi-board “combined view” improvements:
  - [x] List view (not just board/columns), so you can scan lots of cards quickly across multiple selected columns. (PR #304)
  - [x] Better context in rows (board + list labels). (PR #304)
  - [x] Optional “pinned columns” presets and quick switching. (PR #306)

## Telemetry v2 (trends, exports, more signals)

- [ ] Add more signals: commits, PR reviews, PR merges, tasks created/completed, and per-project throughput.
- [ ] Exports + sharing:
  - [x] JSON export (PR #308)
  - [ ] “Share snapshot” links (optional)
- [ ] Long-running “health” dashboards per project (risk rollups + backlog + lead time).

## Automation v2 (integrations)

- [ ] Trello automation expansions on PR merge:
  - [ ] Per-board conventions beyond “Done list”: labels, checklists, and “needs_fix” feedback loops.
  - [ ] Optional auto-comment templates (links to prompt artifacts, review outcomes, verification notes).
- [ ] Worktree fleet automation:
  - [ ] “Create N worktrees” presets per project (small/medium/large).
  - [ ] Smarter “free worktree” scoring and cleanup hints.
