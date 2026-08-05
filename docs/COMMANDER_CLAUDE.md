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

## Supervisor (the fleet watchdog)

A rule-driven loop classifies every agent session every 30s from zero-token signals (PTY tail, status, quiet time, git state — plus structured app-server events for Codex threads) and tries to fix what it finds. Ask it what needs attention instead of reading 16 terminals yourself.

```bash
# What needs a human right now — start here
curl -sS "$BASE_URL/api/supervisor/briefing" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Everything recorded recently (filter by severity or session)
curl -sS "$BASE_URL/api/supervisor/findings?severity=critical" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Loop config: autonomy level, tick rate, which conditions are armed
curl -sS "$BASE_URL/api/supervisor/status" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Force a pass now (dryRun reports findings without acting on them)
curl -sS -X POST "$BASE_URL/api/supervisor/tick" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"dryRun": true}' | jq
```

**Autonomy levels** — `off` (nothing runs) | `observe` (record only) | `assist` (may repair things itself) | `autopilot` (default: may also delegate to a Commander).

Autonomy governs what JARVIS may **fix**, not what it may say. Reaching a human is gated separately: a finding must exhaust its repair attempts, then clear an urgency threshold weighted by the task's tier, then fit inside an interruption budget. Everything else batches into a digest.

**You may be on the receiving end of this.** When rules cannot fix something, the problem is delegated to a Commander as a `[JARVIS]` problem brief with the session, branch, tier and output tail. That is a request to diagnose and fix it — not to relay it to the user. Escalate to a human only if you are genuinely blocked on a decision only they can make.

```bash
# What is waiting but did not earn an interruption
curl -sS "$BASE_URL/api/supervisor/digest" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# "Catch me up" — deliver the batch now
curl -sS -X POST "$BASE_URL/api/supervisor/digest/deliver" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" -d '{}' | jq
```

```bash
curl -sS -X POST "$BASE_URL/api/supervisor/autonomy" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"level": "assist"}'
```

**Never change the autonomy level on your own** — raising or lowering it is the user's decision. Rules live in `config/supervisor-rules.json`, overridable at `~/.agent-workspace/supervisor-rules.json` and by `SUPERVISOR_AUTONOMY`; every action is appended to `~/.agent-workspace/logs/supervisor-audit.jsonl`.

## Speech

```bash
# Say something out loud
curl -sS -X POST "$BASE_URL/api/speech/say" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "Work three is waiting on permission."}'

# Speak the fleet briefing
curl -sS -X POST "$BASE_URL/api/speech/briefing" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" -d '{}' | jq

curl -sS "$BASE_URL/api/speech/status" -H "X-Auth-Token: $AUTH_TOKEN" | jq
```

Default backend is the browser's own synthesis (nothing to install); piper/`say`/SAPI/espeak take over when present. Keep spoken text to one or two short sentences — it is read aloud, not displayed.

## Repo Atlas (cross-repo prior art)

The map of every repo the user owns, cloned or not, with per-topic quality scores. Query it before searching the filesystem for "how did we do X before".

```bash
# The main query: who did this well?
curl -sS "$BASE_URL/api/atlas/find?topic=data-compression" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Compact map worth pasting into a prompt
curl -sS "$BASE_URL/api/atlas/digest" -H "X-Auth-Token: $AUTH_TOKEN" | jq -r .digest

curl -sS "$BASE_URL/api/atlas/entries/acme-tycoon" -H "X-Auth-Token: $AUTH_TOKEN" | jq -r .description
curl -sS "$BASE_URL/api/atlas/topics" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Record what a repo turned out to be good at
curl -sS -X POST "$BASE_URL/api/atlas/entries/acme-tycoon/highlights" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"topic": "data-compression", "quality": 5, "paths": ["src/data/"], "notes": "bitpacked saves"}'
```

Also available as a CLI anywhere: `node scripts/atlas.js find <topic>`.

**Do not change a repo's `visibility` or `groups`, and do not compile or publish sharing bundles, without being asked.** Those decide what leaves the machine.

The registry syncs between machines via a private git repo (`GET/POST /api/atlas/sync`). Entries marked `foreign: true` were shared with you by someone else — read them, never re-share them.

## Codex app-server (structured signals + realtime voice)

Opt-in via `CODEX_APP_SERVER=true`. When on, Codex threads report state as facts instead of being scraped, and approvals arrive with the command attached.

```bash
curl -sS "$BASE_URL/api/app-server/status" -H "X-Auth-Token: $AUTH_TOKEN" | jq
curl -sS "$BASE_URL/api/app-server/approvals" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Grant or refuse an approval over the wire
curl -sS -X POST "$BASE_URL/api/app-server/approvals/<requestId>" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"approved": true}'

# Full-duplex voice on a thread
curl -sS -X POST "$BASE_URL/api/app-server/realtime/<threadId>/start" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" -d '{}'
```

Only approve something you would approve yourself — the same fail-closed rules apply, and the command is right there in the request.

## Atlas write-back

After substantial work, propose what you learned. You cannot write to the map directly.

```bash
curl -sS -X POST "$BASE_URL/api/atlas/proposals" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"repoId":"acme-tycoon","topic":"data-compression","quality":5,
       "paths":["src/data/"],"notes":"bitpacked saves",
       "evidence":"12x smaller than the JSON it replaced, benchmarked",
       "proposedBy":"acme-tycoon-work1-claude"}'
```

Always include `evidence`. Proposals without it get rejected, and rightly so.

## Discord (ambient team work)

The watcher reads whole channels rather than waiting to be addressed, turns assignments into tracked work with a priority, and publishes status back so nobody has to ask whether an agent picked something up.

```bash
# Asked for, nobody started — ordered by priority
curl -sS "$BASE_URL/api/discord-watch/untracked" -H "X-Auth-Token: $AUTH_TOKEN" | jq

curl -sS "$BASE_URL/api/discord-watch/items?status=in-progress" -H "X-Auth-Token: $AUTH_TOKEN" | jq
curl -sS "$BASE_URL/api/discord-watch/status" -H "X-Auth-Token: $AUTH_TOKEN" | jq

# Bind a work item to the session doing it — this is what makes agent status visible to the team
curl -sS -X POST "$BASE_URL/api/discord-watch/items/discord:123/link" \
  -H "X-Auth-Token: $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"sessionId": "acme-tycoon-work1-claude"}'
```

Link a work item whenever you start a session for one — an unlinked item looks untouched to everyone else. Work item tiers come from how urgently the message was phrased, and they flow into the task record, so linking also sets the session's tier correctly.

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
