# Commander Claude - API Reference

You are Commander (Claude or Codex). You can control the Claude Orchestrator by calling these HTTP APIs via `curl`.

Runtime connection info (desktop builds pick a free port each launch):
- Host: `ORCHESTRATOR_HOST` (default `127.0.0.1`)
- Port: `ORCHESTRATOR_PORT` (default `9460` for `npm start`)
- Auth: if `AUTH_TOKEN` is set, every request must include `-H "X-Auth-Token: $AUTH_TOKEN"` (or `?token=$AUTH_TOKEN`)

**Base URL:** `http://${ORCHESTRATOR_HOST:-127.0.0.1}:${ORCHESTRATOR_PORT:-9460}`

Optional helper (bash):
```bash
BASE_URL="http://${ORCHESTRATOR_HOST:-127.0.0.1}:${ORCHESTRATOR_PORT:-9460}"
# If AUTH_TOKEN is set, add: -H "X-Auth-Token: $AUTH_TOKEN"
```

---

## Command Registry (Recommended)

The Command Registry provides semantic, self-documenting commands. **This is the preferred way to control the Orchestrator.**

### Discover Available Commands
```bash
# See all available commands with descriptions and examples
curl -sS "$BASE_URL/api/commander/capabilities" -H "X-Auth-Token: $AUTH_TOKEN" | jq
```

### Get Live Context (Recommended)
```bash
# See current UI/session context (selected queue item, sessions, workspace, etc.)
curl -sS "$BASE_URL/api/commander/context" -H "X-Auth-Token: $AUTH_TOKEN" | jq
```

### Get Runtime Help Prompt (Self-Updating)
```bash
# Plain-text prompt generated from the command registry + current context
curl -sS "$BASE_URL/api/commander/prompt" -H "X-Auth-Token: $AUTH_TOKEN"
```

### Execute Commands
```bash
# General syntax
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "COMMAND_NAME", "params": {...}}'

# Focus on a terminal
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "focus-session", "params": {"sessionId": "work1-claude"}}'

# Switch workspace
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "switch-workspace", "params": {"name": "Epic Survivors"}}'

# Open Commander panel
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "open-commander"}'

# Open New Project wizard
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "open-new-project"}'

# Start Claude in a session
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "start-claude", "params": {"sessionId": "work1-claude"}}'

# Run a shell command
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "run-command", "params": {"sessionId": "work1-server", "command": "npm test"}}'

# Broadcast to multiple sessions
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "broadcast", "params": {"sessionIds": ["work1-claude", "work2-claude"], "input": "git pull\n"}}'

# Highlight a worktree in sidebar
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "highlight-worktree", "params": {"worktreeId": "work1"}}'

# Focus a worktree (show ONLY that worktree's terminals, hide others)
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "focus-worktree", "params": {"worktreeId": "work1"}}'

# Show all worktrees again (unfocus)
curl -sS "$BASE_URL/api/commander/execute" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
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
curl -sS "$BASE_URL/api/commander/sessions" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Send input to a specific session
curl -sS "$BASE_URL/api/commander/send-to-session" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "zoo-game-work1-claude", "input": "git status\n"}'
```

## Workspace Management

```bash
# List all workspaces
curl -sS "$BASE_URL/api/workspaces" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Scan for available repos
curl -sS "$BASE_URL/api/workspaces/scan-repos" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Create a new worktree
curl -sS "$BASE_URL/api/workspaces/create-worktree" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repoPath": "~/GitHub/games/monogame/zoo-game", "branchName": "feature/new-work"}'

# Remove a worktree
curl -sS "$BASE_URL/api/workspaces/remove-worktree" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"worktreePath": "~/GitHub/games/monogame/zoo-game/work5"}'
```

## Greenfield Projects

```bash
# Get available project templates
curl -sS "$BASE_URL/api/greenfield/templates" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Create new project
curl -sS "$BASE_URL/api/greenfield/create" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "path": "~/GitHub", "template": "empty"}'
```

## Git Operations

```bash
# Check git status across worktrees
curl -sS "$BASE_URL/api/git/status" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Check for updates
curl -sS "$BASE_URL/api/git/check-updates" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Pull updates
curl -sS "$BASE_URL/api/git/pull" -H "X-Auth-Token: $AUTH_TOKEN" -X POST
```

## Quick Links & Favorites

```bash
# Get quick links and favorites
curl -sS "$BASE_URL/api/quick-links" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Get recent sessions
curl -sS "$BASE_URL/api/quick-links/recent-sessions" -H "X-Auth-Token: $AUTH_TOKEN" | jq
```

## Continuity (Session Memory)

```bash
# Get continuity ledger for current workspace
curl -sS "$BASE_URL/api/continuity/ledger" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Get workspace continuity info
curl -sS "$BASE_URL/api/continuity/workspace" -H "X-Auth-Token: $AUTH_TOKEN" | jq
```

## User Settings

```bash
# Get all user settings
curl -sS "$BASE_URL/api/user-settings" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Update global settings
curl -sS "$BASE_URL/api/user-settings/global" \
  -H "X-Auth-Token: $AUTH_TOKEN" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"theme": "dark", "notifications": true}'
```

## Port Management

```bash
# Get all port assignments
curl -sS "$BASE_URL/api/ports" -H "X-Auth-Token: $AUTH_TOKEN" | jq
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
for sid in $(curl -sS "$BASE_URL/api/commander/sessions" -H "X-Auth-Token: $AUTH_TOKEN" | jq -r '.sessions[] | select(.id | contains("claude")) | .id'); do
  curl -sS "$BASE_URL/api/commander/send-to-session" \
    -H "X-Auth-Token: $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\": \"$sid\", \"input\": \"# Message from Commander\n\"}"
done
```

### Check what each session is working on
```bash
curl -sS "$BASE_URL/api/commander/sessions" -H "X-Auth-Token: $AUTH_TOKEN" | jq '.sessions[] | {id, status, branch}'
```
