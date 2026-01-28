# Post-ship issues / wishlist (after 2026-01-25 brain dump)

The 2026-01-25 brain-dump implementation plan is fully checked off; this file tracks *new* issues and follow-ups reported afterwards.

## Bugs / regressions

- [x] Status lights: avoid false “waiting” when output ends with a lone `>` line (prompt gating in `StatusDetector`). (PR TBD)
- [ ] Status lights: investigate remaining green/orange/grey flicker for agent + worktree dots (esp. Codex sessions).
- [ ] Tasks panel: board view sometimes appears scrolled to the far right (single column “right aligned”).
- [ ] Tasks panel: selecting a card sometimes opens details on the wrong side / causes layout reflow.
- [ ] Worktree status badges: green/grey/orange accuracy still fluctuates while agents are running.
- [ ] Closing a worktree should remove agent/server terminals without requiring a full refresh.

## UX / workflow speed

- [ ] Trello cards: one/two-click “Launch” flow (tier + agent + mode) directly on card rows.
- [ ] Agent window: add a “Launch server” button (not only in server terminals).
- [ ] Tasks defaults: assignee filter should default to “Any”.
- [ ] Add-worktree modal: add “Add another” / “Add + close” flow for rapid multi-worktree creation.
- [ ] Worktree picker: after creating a worktree, exclude it from “next free worktree” suggestions.
- [ ] Worktrees: bulk “Create N worktrees” action.
- [ ] Workflow modes: add an “All tiers” mode to avoid bouncing between focus/background.

## Review UX v2 (bigger next phase)

- [ ] Unified review screen: terminals + changed-files tree + commit log + diff viewer, with presets and a one-at-a-time review conveyor.
- [ ] PR workflow: merge from review screen + move linked Trello card to the correct column (Done/Test/etc) after merge.

