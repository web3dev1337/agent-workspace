# Known Issues

## Workspace Config Not Persisted When Adding Worktrees

**Priority:** Medium
**Category:** Data Persistence
**Discovered:** During tabbed workspace implementation

### Description

When users add worktrees to a workspace (via "Add Worktree" button), the workspace configuration is updated in memory but **not saved to disk**. This causes the dashboard to show outdated worktree counts when reopened later.

### Current Behavior

1. User opens workspace (e.g., "Epic Survivors" with 2 worktrees)
2. User clicks "+ Add Worktree" and adds work3
3. Frontend updates: `this.currentWorkspace.terminals.pairs = 3` (in memory only)
4. User closes orchestrator
5. User reopens orchestrator and views dashboard
6. Dashboard shows: "Epic Survivors - 2 terminals" (wrong! should be 3)

### Root Cause

**File:** `client/app.js` line ~5263

```javascript
async createWorktree(worktreeNumber) {
  // ...
  if (response.ok) {
    // ❌ Only updates in-memory copy
    this.currentWorkspace.terminals.pairs = worktreeNumber;

    // Refreshes workspace but doesn't save to disk
    this.socket.emit('switch-workspace', { workspaceId: this.currentWorkspace.id });
  }
}
```

The workspace config file at `~/.orchestrator/workspaces/{workspace-id}.json` is **never updated**.

### Expected Behavior

When adding/removing worktrees:
1. Update in-memory workspace config ✅ (already working)
2. **Save updated config to disk** ❌ (missing)
3. Reload workspace to reflect changes ✅ (already working)

### Affected Operations

- **Add worktree** (`createWorktree()`) - line 5246
- **Add mixed-repo worktree** (`addWorktreeToWorkspace()`) - line 5214
- **Remove worktree** (`deleteWorktree()`) - updates happen via backend but dashboard may not refresh

### Proposed Fix

**Option 1: Backend API (Preferred)**

Add a backend endpoint to persist workspace config:

```javascript
// server/index.js
app.post('/api/workspaces/:id/update-config', (req, res) => {
  const { id } = req.params;
  const { config } = req.body;

  // Validate config
  // Save to ~/.orchestrator/workspaces/${id}.json
  // Return updated workspace
});
```

Then in `createWorktree()`:

```javascript
await fetch(`/api/workspaces/${this.currentWorkspace.id}/update-config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: {
      ...this.currentWorkspace,
      terminals: { pairs: worktreeNumber }
    }
  })
});
```

**Option 2: Modify Existing Endpoints**

Update `/api/workspaces/create-worktree` to return the full updated workspace config and save it to disk. Backend already has access to workspace files via `WorkspaceManager`.

### Impact

- **Low severity** - Only affects dashboard display
- **User workaround** - Manually edit `~/.orchestrator/workspaces/*.json` files
- **Does not affect** - Active workspaces (they work correctly once loaded)
- **Tab system** - Makes the issue more visible but didn't cause it

### Testing Steps

1. Open workspace with 2 worktrees
2. Add work3 via "+ Add Worktree"
3. Note workspace works correctly (3 worktrees visible)
4. Close orchestrator completely
5. Reopen and view dashboard
6. Bug: Dashboard shows "2 terminals" instead of 3

### Files to Modify

- `server/workspaceManager.js` - Add method to save workspace config to disk
- `server/index.js` - Add endpoint to update workspace config
- `client/app.js` - Call new endpoint after adding/removing worktrees
- `client/dashboard.js` - Potentially add refresh logic

### Related Issues

- Dashboard workspace list is cached and only refreshed on show
- `list-workspaces` socket event reads from disk, so stale data propagates
- Mixed-repo workspaces also affected when adding/removing repos

---

**Note:** This is a pre-existing bug in the orchestrator, not caused by the tabbed workspace feature. The tab system just made it more noticeable because users switch workspaces more frequently.
