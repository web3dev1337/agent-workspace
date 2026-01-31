# Commander Claude - API Reference

You are Commander Claude. You can control the Claude Orchestrator by calling these API endpoints via curl.

**Base URL:** `http://localhost:4000`

---

## Command Registry (Recommended)

The Command Registry provides semantic, self-documenting commands. **This is the preferred way to control the Orchestrator.**

### Discover Available Commands
```bash
# See all available commands with descriptions and examples
curl -s http://localhost:4000/api/commander/capabilities | jq
```

### Get Live Context (Recommended)
```bash
# See current UI/session context (selected queue item, sessions, workspace, etc.)
curl -s http://localhost:4000/api/commander/context | jq
```

### Get Runtime Help Prompt (Self-Updating)
```bash
# Plain-text prompt generated from the command registry + current context
curl -s http://localhost:4000/api/commander/prompt
```

### Execute Commands
```bash
# General syntax
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "COMMAND_NAME", "params": {...}}'

# Focus on a terminal
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "focus-session", "params": {"sessionId": "work1-claude"}}'

# Switch workspace
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "switch-workspace", "params": {"name": "Epic Survivors"}}'

# Open Commander panel
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "open-commander"}'

# Open New Project wizard
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "open-new-project"}'

# Start Claude in a session
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "start-claude", "params": {"sessionId": "work1-claude"}}'

# Run a shell command
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "run-command", "params": {"sessionId": "work1-server", "command": "npm test"}}'

# Broadcast to multiple sessions
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "broadcast", "params": {"sessionIds": ["work1-claude", "work2-claude"], "input": "git pull\n"}}'

# Highlight a worktree in sidebar
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "highlight-worktree", "params": {"worktreeId": "work1"}}'

# Focus a worktree (show ONLY that worktree's terminals, hide others)
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "focus-worktree", "params": {"worktreeId": "work1"}}'

# Show all worktrees again (unfocus)
curl -s http://localhost:4000/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "show-all-worktrees"}'
```

### Available Command Categories
- **sessions**: focus-session, send-to-session, list-sessions
- **workspaces**: switch-workspace, list-workspaces
- **ui**: open-commander, open-new-project, open-settings, highlight-worktree, focus-worktree, show-all-worktrees
- **terminals**: start-claude, stop-session, run-command
- **git**: get-git-status
- **coordination**: broadcast

---

## Session Control

```bash
# View all active sessions
curl -s http://localhost:4000/api/commander/sessions | jq

# Send input to a specific session
curl -s http://localhost:4000/api/commander/send-to-session \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "zoo-game-work1-claude", "input": "git status\n"}'
```

## Workspace Management

```bash
# List all workspaces
curl -s http://localhost:4000/api/workspaces | jq

# Scan for available repos
curl -s http://localhost:4000/api/workspaces/scan-repos | jq

# Create a new worktree
curl -s http://localhost:4000/api/workspaces/create-worktree \
  -H "Content-Type: application/json" \
  -d '{"repoPath": "/home/ab/GitHub/games/monogame/zoo-game", "branchName": "feature/new-work"}'

# Remove a worktree
curl -s http://localhost:4000/api/workspaces/remove-worktree \
  -H "Content-Type: application/json" \
  -d '{"worktreePath": "/home/ab/GitHub/games/monogame/zoo-game/work5"}'
```

## Greenfield Projects

```bash
# Get available project templates
curl -s http://localhost:4000/api/greenfield/templates | jq

# Create new project
curl -s http://localhost:4000/api/greenfield/create \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "path": "~/GitHub", "template": "empty"}'
```

## Git Operations

```bash
# Check git status across worktrees
curl -s http://localhost:4000/api/git/status | jq

# Check for updates
curl -s http://localhost:4000/api/git/check-updates | jq

# Pull updates
curl -s http://localhost:4000/api/git/pull -X POST
```

## Quick Links & Favorites

```bash
# Get quick links and favorites
curl -s http://localhost:4000/api/quick-links | jq

# Get recent sessions
curl -s http://localhost:4000/api/quick-links/recent-sessions | jq
```

## Continuity (Session Memory)

```bash
# Get continuity ledger for current workspace
curl -s http://localhost:4000/api/continuity/ledger | jq

# Get workspace continuity info
curl -s http://localhost:4000/api/continuity/workspace | jq
```

## User Settings

```bash
# Get all user settings
curl -s http://localhost:4000/api/user-settings | jq

# Update global settings
curl -s http://localhost:4000/api/user-settings/global \
  -X PUT -H "Content-Type: application/json" \
  -d '{"theme": "dark", "notifications": true}'
```

## Port Management

```bash
# Get all port assignments
curl -s http://localhost:4000/api/ports | jq
```

## Direct File System Access

You can also run shell commands directly:

```bash
# List GitHub repos
ls ~/GitHub/

# Check git status in a worktree
git -C ~/GitHub/games/monogame/zoo-game/work1 status

# List all worktrees for a repo
git -C ~/GitHub/games/monogame/zoo-game worktree list
```

## Common Tasks

### Broadcast message to all Claude sessions
```bash
for sid in $(curl -s http://localhost:4000/api/commander/sessions | jq -r '.sessions[] | select(.id | contains("claude")) | .id'); do
  curl -s http://localhost:4000/api/commander/send-to-session \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$sid\", \"input\": \"# Message from Commander\n\"}"
done
```

### Check what each session is working on
```bash
curl -s http://localhost:4000/api/commander/sessions | jq '.sessions[] | {id, status, branch}'
```
