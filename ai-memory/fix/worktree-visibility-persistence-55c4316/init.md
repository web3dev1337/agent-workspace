# Fix: Worktree Visibility Persistence (Issue #786)

## User Request
Fix GitHub issue #786: "Closed worktrees become visible again after switching workspaces"

When a user closes/hides worktrees in a workspace, switches to a different workspace, then switches back, the previously closed worktrees are restored to visible. The closed/hidden state should persist across workspace switches.
