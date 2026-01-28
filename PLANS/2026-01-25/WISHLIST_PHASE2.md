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

- [ ] Review Console v1: unified per-worktree review surface (terminals + files + commits + diff) tied to Queue “Next”. (See `PLANS/2026-01-25/REVIEW_CONSOLE_V1.md`)
- [x] “Conveyor” mode for Review: one-at-a-time Tier 2 queue + explicit “Next” affordances (minimize decision fatigue). (PR #313)
- [x] Stronger “Review complete” feedback loop: per-task nudges, sound/desktop options, and auto-open next item when configured. (PR #313)
- [ ] “Background” mode improvements: triage queue + auto-scheduling rules (e.g., tiered retries, safe backoff).
  - [x] Background-launched worktrees become visible when switching to Background mode (without auto-showing them in Review/Focus). (PR #320)
  - [x] Background triage Queue preset (T3+T4) + snooze (“safe backoff”). (PR #324)
  - [x] Triage: tiered auto-snooze backoff (15m → 1h → 4h → 24h). (PR #331)

## Advisor / Coach v2 (recommendations)

- [ ] Expand advisor inputs: dependencies + telemetry + risk + verifyMinutes + reviewOutcome history.
  - [x] Added verifyMinutes + changeRisk/tier mismatch signals. (PR #335)
- [ ] Add “project readiness” checklists (playtest / launch / domain / hosting / security) as templates and/or heuristics.
- [ ] Commander/voice hooks to consume advice: “what should I do next?”, “show blockers”, “start next review”.
  - [x] Voice: “what should I do next?” opens Advice. (PR #339)
  - [x] Voice: “show blockers” opens Queue filtered to blocked items. (PR #341)
  - [x] Voice: “start next review” opens Queue and advances to Next. (PR #341)
  - [x] Voice: “triage queue” opens Queue in triage mode. (PR #345)
  - [x] Advice UI: “Show blockers” and “Start next review” actions. (PR #342, #343)
  - [x] Commander/voice: open PRs panel. (PR #347)

## Dependency graph v2 (UX)

- [ ] Richer dependency graph UI: timeline-ish “blocked by / unblocks” flow, better satisfaction reasons, and quick edits.
- [ ] Multi-board dependency normalization: show Trello + PR + local deps together with consistent icons and links.

## Tasks v2 (multi-board)

- [x] Multi-board “combined view” improvements:
  - [x] List view (not just board/columns), so you can scan lots of cards quickly across multiple selected columns. (PR #304)
  - [x] Better context in rows (board + list labels). (PR #304)
  - [x] Optional “pinned columns” presets and quick switching. (PR #306)

## Telemetry v2 (trends, exports, more signals)

- [ ] Add more signals: commits, PR reviews, PR merges, tasks created/completed, and per-project throughput.
  - [x] Throughput + outcomes from task records: doneCount series, avgVerifyMinutes, outcomeCounts, richer exports. (PR #317)
  - [x] Dashboard UI shows done/outcomes/verify + throughput chart. (PR #318)
  - [x] PR merges + Trello automation events: prMergedAt, ticketMovedAt, ticketClosedAt (summary + series + exports). (PR #334)
  - [x] Tasks created: task record `createdAt` + telemetry `createdCount` (summary + series + exports). (PR #352)
- [x] Exports + sharing:
  - [x] JSON export (PR #308)
  - [x] “Share snapshot” links (PR #311)
- [ ] Long-running “health” dashboards per project (risk rollups + backlog + lead time).

## Automation v2 (integrations)

- [ ] Trello automation expansions on PR merge:
  - [ ] Per-board conventions beyond “Done list”: labels, checklists, and “needs_fix” feedback loops.
    - [x] Queue outcome → Trello feedback loop: apply configured `needsFixLabelName` (and optional comment from Notes). (PR #316)
    - [x] PR merge → Trello labels: apply configured `mergedLabelNames` (case-insensitive by label name). (PR #333)
    - [x] PR merge → Trello checklist item: configure `mergedChecklistName` + `mergedChecklistItemTemplate`. (PR #336)
  - [x] Optional auto-comment templates (links to prompt artifacts, review outcomes, verification notes). (PR #326)
- [x] Worktree fleet automation:
  - [x] “Create N worktrees” presets per project (small/medium/large). (PR #330)
  - [x] Smarter “free worktree” scoring and cleanup hints. (PR #329)

---

## Live UX reports / regression watchlist (verify on latest `main`)

- [x] Status indicator lights (green/orange/grey) can flicker or be inaccurate while agents/worktrees are active. (PR #315)
  - Still occasionally reported; if seen again, capture a short screen recording + logs for a targeted follow-up.
  - Reported again 2026-01-28: lights can bounce green→orange→grey while an agent is actively working.
  - Added a small UI-side “delay idle” stabilizer to reduce rapid busy→idle flicker. (PR #328)
  - Added UI-side “delay waiting” stabilizer to reduce rapid busy→waiting flicker. (PR #353)
- [x] Tasks panel: card detail pane sometimes opens on the wrong side and/or causes vertical reflow of the board area. (PR #327)
  - Reported again 2026-01-28: detail can appear on the left and/or shift the board vertically (capture List/Board/Combined + screenshot).
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
  - Dashboard now shows HTTP error details and supports one-click retry. (PR #337)
- [x] Header: add an explicit “🔍 Diff” button to open Advanced Diff Viewer (not only per-PR buttons). (PR #365)
- [x] Worktree list + terminal headers: branch labels should be compact (hide common prefixes), remove forced “@”, and be color-coded by type (feature/fix/etc.), with toggles in Settings. (PR #357)
  - Default/no-prefix branches now also render with a blue label (not just prefixed branches). (PR #364)
- [x] Workflow: add an “All” view so you can see all tiers without swapping Focus/Background; explicit tier filter (T1–T4/None) should override workflow filtering. (PR #359)
- [x] Header: add Tier filter buttons (All/T1/T2/T3/T4/None) so you can jump between tiers without re-filtering or swapping modes. (PR #360)
- [x] Hotkeys: Alt+1/2/3/4 sets Tier filter; Alt+0 or Alt+A sets All; Alt+N sets None. (PR #361)
- [x] Hotkeys: Alt+F/R/B/G switches workflow mode (Focus/Review/Background/All). (PR #362)
- [x] Persist terminal filters (View mode + Tier filter) across refreshes (server-backed user settings). (PR #363)
- [x] Queue: add 🗂 Inspect action to open Worktree Inspector from Queue detail (Review Console entrypoint). (PR #367)
- [x] Worktree Inspector: Files Tree/List toggle with folder structure + aggregated staged/unstaged +/- stats. (PR #369)
