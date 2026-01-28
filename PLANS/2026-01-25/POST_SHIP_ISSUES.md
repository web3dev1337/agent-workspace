# Post-ship issues / wishlist (after 2026-01-25 brain dump)

The 2026-01-25 brain-dump implementation plan is fully checked off; this file tracks *new* issues and follow-ups reported afterwards.

## Bugs / regressions

- [x] Status lights: avoid false “waiting” when output ends with a lone `>` line (prompt gating in `StatusDetector`). (PR #394)
- [x] Status lights: investigate remaining green/orange/grey flicker for agent + worktree dots (esp. Codex sessions). (Mitigations: treat `*-claude` terminals as “busy” for longer quiet windows, PR #398; Codex prompt heuristic, PR #400)
- [x] Commander: Ctrl/Cmd+V paste doesn’t work in Commander terminal (right-click paste works). (PR #397)
- [x] E2E suite: reduce flakiness in workspace boot, process banner, and Commander tests. (PR #403)
- [x] Tasks panel: board view sometimes appears scrolled to the far right (single column “right aligned”). (PR #395)
- [x] Tasks panel: selecting a card sometimes opens details on the wrong side / causes layout reflow. (PR #395)
- [x] Worktree status badges: green/grey/orange accuracy still fluctuates while agents are running. (PR #400)
- [x] Closing a worktree should remove agent/server terminals without requiring a full refresh.

## UX / workflow speed

- [x] Trello cards: one/two-click “Launch” flow (tier + agent + mode) directly on card rows.
- [x] Agent window: add a “Launch server” button (not only in server terminals).
- [x] Tasks defaults: assignee filter should default to “Any”.
- [x] Add-worktree modal: add “Add another” / “Add + close” flow for rapid multi-worktree creation.
- [x] Worktree picker: after creating a worktree, exclude it from “next free worktree” suggestions.
- [x] Worktrees: bulk “Create N worktrees” action.
- [x] Workflow modes: add an “All tiers” mode to avoid bouncing between focus/background.

## Review UX v2 (bigger next phase)

- [x] Unified review screen: terminals + changed-files tree + commit log + diff viewer, with presets and a one-at-a-time review conveyor.
- [x] PR workflow: merge from review screen + move linked Trello card to the correct column (Done/Test/etc) after merge.
