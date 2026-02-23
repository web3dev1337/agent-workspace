# Plan

## Root Cause
In `client/app.js`, the `workspace-changed` handler for existing tabs calls `handleInitialSessions(sessions)` AFTER `switchTab()` restores the tab's saved visibility state. `handleInitialSessions` checks `this.lastSessionsWorkspaceId` vs `this.currentWorkspace.id` to decide whether to preserve visibility. Since `lastSessionsWorkspaceId` still points to the previous workspace, it treats this as a workspace change and resets all terminals to visible.

## Fix
Set `this.lastSessionsWorkspaceId = workspace.id` before calling `handleInitialSessions` in the existing-tab branch. This makes `handleInitialSessions` treat it as a same-workspace refresh, preserving the visibility state restored from the tab.

## Files Changed
- `client/app.js` - Added 3 lines (comment + assignment) before `handleInitialSessions` call in existing-tab branch of `workspace-changed` handler
