# Phase 2 Wishlist (Post Brain Dump Shipping)

Last updated: 2026-01-28

This is the “bigger than PR-sized” wishlist after the 2026-01-25 brain dump core shipped.

Source context:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/REMAINING_NEXT_PHASE.md` (what shipped + what’s left)

Process discipline:
- Small PRs; run tests; commit + push + merge continuously.
- Work only in the dev worktree (do not touch the separate `/master` worktree checkout).

---

## Workflow v2 (Focus / Review / Background)

- [x] “Conveyor” mode for Review: one-at-a-time Tier 2 queue + explicit “Next” affordances (minimize decision fatigue). (PR #313)
- [x] Stronger “Review complete” feedback loop: per-task nudges, sound/desktop options, and auto-open next item when configured. (PR #313)
- [ ] “Background” mode improvements: triage queue + auto-scheduling rules (e.g., tiered retries, safe backoff).
  - [x] Background-launched worktrees become visible when switching to Background mode (without auto-showing them in Review/Focus). (PR #320)
  - [x] Background triage Queue preset (T3+T4) + snooze (“safe backoff”). (PR #324)

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
  - [x] Throughput + outcomes from task records: doneCount series, avgVerifyMinutes, outcomeCounts, richer exports. (PR #317)
  - [x] Dashboard UI shows done/outcomes/verify + throughput chart. (PR #318)
- [ ] Exports + sharing:
  - [x] JSON export (PR #308)
  - [x] “Share snapshot” links (PR #311)
- [ ] Long-running “health” dashboards per project (risk rollups + backlog + lead time).

## Automation v2 (integrations)

- [ ] Trello automation expansions on PR merge:
  - [ ] Per-board conventions beyond “Done list”: labels, checklists, and “needs_fix” feedback loops.
    - [x] Queue outcome → Trello feedback loop: apply configured `needsFixLabelName` (and optional comment from Notes). (PR #316)
  - [x] Optional auto-comment templates (links to prompt artifacts, review outcomes, verification notes). (PR #TBD)
- [ ] Worktree fleet automation:
  - [ ] “Create N worktrees” presets per project (small/medium/large).
  - [ ] Smarter “free worktree” scoring and cleanup hints.

---

## Live UX reports / regression watchlist (verify on latest `main`)

- [x] Status indicator lights (green/orange/grey) can flicker or be inaccurate while agents/worktrees are active. (PR #315)
- [ ] Tasks panel: card detail pane sometimes opens on the wrong side and/or causes vertical reflow of the board area.
- [x] Tasks launch UX: from a card, launch `T1/T2/T3/T4` agent in 1–2 clicks (dropdown + hotkey-friendly). (PR #321)
- [x] Tasks panel: Trello board “mapping/settings” control should always open (if it appears enabled); if no-op, surface an error/toast. (PR #314)
- [x] Tasks panel: Trello board colors/background per-board (verify consistency). (PR #300)
- [x] Agent terminal header: “Start server” control should be present and functional (no hunting in other panels). (PR #277)
- [x] Tasks panel: “Open Trello board” quick link should exist and point at the selected board. (PR #279)
- [x] Add-worktree modal: support “Add & close” and “Add another” (keep adding without modal churn), and refresh availability immediately. (PR #285)
- [x] Removing a worktree from a workspace should remove both terminals immediately (no F5 needed). (PR #281)
- [x] Tasks panel: default assignee filter should be “All/Any”, not implicitly “me”. (PR #283)
- [x] Tasks panel: “New task” button should be obvious and always visible when a board is selected. (PR #287)
- [x] Worktree “quick add” should re-evaluate after creating a new worktree (avoid suggesting the just-created worktree as “free”). (PR #289)
- [x] Worktree “quick add”: allow “create N worktrees” (e.g., 5 at once) + optional background start. (PR #292)
- [x] Tasks board “wrap/expand” layout: ensure column auto-layout minimizes columns (consider collapsed/hidden lists and fill vertically before adding columns). (PR #294)
- [x] Dashboard “Advice” tile shows “Failed to load” (investigate `/api/process/advice` errors on fresh startups). (PR #323)
