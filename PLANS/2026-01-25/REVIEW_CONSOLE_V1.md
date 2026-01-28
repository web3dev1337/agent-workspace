# Review Console v1 (Unified Focus/Review View)

Date: 2026-01-28

This doc captures the next “workflow UX” priority after core brain-dump shipping:
**a unified, fast review surface** that combines terminals + git file/commit context + diff viewing,
and works whether the “thing to review” is a PR or just a worktree/session with changes.

Related context:
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md`
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md`
- `PLANS/2026-01-25/WISHLIST_PHASE2.md`

---

## Problem

The current UI makes it hard to “click click click” through review work:
- There are multiple places to look (Queue, terminals, Diff Viewer, Tasks/Trello).
- “Ready for review” exists in multiple forms:
  1) **Worktree/agent ready** (you’re done with an iteration; wants human review)
  2) **PR ready** (a PR exists; it may keep receiving commits)
- The user wants a **single review surface** that can show the relevant worktree(s) and the relevant review context with minimal switching.

---

## Goal

Create a **Review Console** view that can show, for one (or a few) worktrees at a time:
1) **Terminal(s)**: agent + optional server (existing terminal tiles)
2) **Files**: folder tree + per-file change stats (+/-), staged vs unstaged, untracked
3) **Commits**: recent commit list with timestamps and messages (ideally scoped to the review unit)
4) **Diff viewer**: advanced diff UI (v1 via new-tab; v2 optionally embedded)

This must integrate with existing workflow modes:
- **Focus** (Tier 1–2), **Review** (Queue-driven), **Background** (Tier 3–4), plus **All**.

---

## Review units (what can be reviewed)

We need a single abstraction: **Review Unit**.

A review unit may be:
- A **PR task** (`pr:owner/repo#123`) → best-case review input (URL + diff).
- A **worktree** (ready-for-review tag, or “agent finished” signal) → may or may not have a PR.
- A **session** (e.g. question asked, no PR) → still might have changes.
- A **ticket** (Trello card) → optional attachment to the above (not always present).

---

## Required actions inside Review Console

### Must-have
- Open PR (if present).
- Open Advanced Diff Viewer (PR or commit; and a “home” button for Diff Viewer).
- ✅ Start/Stop review timer + set review outcome (also supports notes). (PR #376)

### Strongly desired
- ✅ Merge PR from the Review Console (when mergeable). (PR #372)
- ✅ Move the attached ticket/card to Done list when a ticket exists. (PR #374)
  - Still TODO: configurable target lists beyond Done (Test/QA/etc).
  - Should respect per-board conventions (Done list, etc) when configured.

---

## UI behavior

### “Sections” toggle model (fast)

The Review Console should allow these sections to be turned on/off:
- Terminals
- Files
- Commits
- Diff

With presets:
- Default: Terminals only
- Review: Terminals + Files + Diff
- Deep review: Terminals + Files + Commits + Diff
- Code-only: Files + Diff (no terminals)

### Scope (how many worktrees)

Likely default to **one review unit at a time**, but allow 2–3 when screen allows.

### Queue integration

In Review mode:
- Selecting an item in Queue should offer **Open Review Console**.
- ✅ Queue: “Auto Console” toggle auto-opens Review Console for worktree/session items while navigating. (PR #378)
- Queue detail now includes **🗂 Inspect** to open the Worktree Inspector for the selected task (session/worktree-aware). (PR #367)
- “Next” should advance the review unit (Tier 3 first, but configurable).

---

## Implementation plan (PR-sized steps)

1) **Entry points / navigation**
   - Ensure “Advanced Diff Viewer” has an obvious entry point from the main header (and not only from PR-link auto-detection).
2) **Worktree Inspector (v1)**
   - Add a Worktree Inspector modal showing per-file change stats (+/-) and recent/unpushed commits. (PR #366)
   - Expose the Worktree Inspector from Queue detail actions (so review can start from “Next”). (PR #367)
3) **Worktree Inspector (v2)**
   - Add a Tree/List toggle for files (folder structure + aggregated staged/unstaged +/-). (PR #369)
   - Server endpoint(s) to provide:
     - `git status --porcelain` lines (staged/unstaged/untracked)
     - `git diff --stat` (and optionally `--numstat`)
     - optionally a folder tree aggregation (server-side, if needed for richer views)
4) **Commit list**
   - Server endpoint to provide commit log for a worktree (ideally “since base branch merge-base”).
5) **Review Console overlay**
   - Layout engine for sections + presets.
   - Bind to Queue selection / “Next”.
6) **Actions**
   - ✅ Merge PR button (server-side `gh pr merge` wrapper; reuse existing PR metadata). (PR #372)
   - ✅ Ticket move button (Trello provider move list; reuse board conventions/mappings). (PR #374)
