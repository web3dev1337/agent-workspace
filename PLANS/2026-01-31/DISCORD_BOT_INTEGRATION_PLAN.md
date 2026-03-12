# Discord Bot (Claudesworth) Integration Plan

Date: 2026-01-31
Updated: 2026-02-01

## Overview

Integrate the Discord Task Bot "Claudesworth" into the Claude Orchestrator so that:
1. The bot runs as a managed terminal/service within the orchestrator
2. A dedicated Claude Code session processes queued tasks
3. The orchestrator UI shows Discord bot status

## Status (updated 2026-02-01)

Shipped in the orchestrator repo (merged to `main`):
- `server/discordIntegrationService.js` (status + ensure-services + process-queue)
- API endpoints:
  - `GET /api/discord/status`
  - `POST /api/discord/ensure-services`
  - `POST /api/discord/process-queue`
- Dashboard summary + controls (ensure services / process queue / open Services workspace)
- Voice + Commander commands for Discord (e.g. “process discord queue”, “open services”, “discord status”)

Still external (optional / depends on your bot implementation):
- If you want the Discord bot itself to call the orchestrator’s dedicated endpoints, update the bot repo to hit `/api/discord/*` (it can continue using `send-to-session` if you prefer).

## Current State

### Discord Bot Location
```
~/GitHub/tools/discord-task-bot/
```

### Bot Capabilities
- `@Claudesworth task: xyz` → Creates Trello card directly (no AI)
- `@Claudesworth queue: xyz` → Queues task for Claude Code to process
- `@Claudesworth dump N` → Saves last N messages to file
- `@Claudesworth process` → Triggers Claude Code via orchestrator API
- `@Claudesworth status` → Shows orchestrator/queue status

### Queue Files
```
~/.claude/discord-queue/
├── pending-tasks.json    # Queued tasks waiting for Claude Code
└── recent-messages.json  # Dumped messages for analysis
```

### Bot Config
```
~/GitHub/tools/discord-task-bot/.env
- DISCORD_BOT_TOKEN (already set)
- DISCORD_ALLOWED_CHANNELS (optional, comma-separated channel IDs)
- TRELLO_API_KEY (from ~/.trello-credentials)
- TRELLO_TOKEN (from ~/.trello-credentials)
```

### Bot Start Command
```bash
cd ~/GitHub/tools/discord-task-bot && npm run dev
# or for production:
cd ~/GitHub/tools/discord-task-bot && npm run build && npm start
```

## Integration Requirements

### 1. Add Claudesworth as Orchestrator Terminal

Create a new terminal type or workspace entry for the Discord bot:

**Option A: Add to existing workspace as a special terminal**
- Terminal name: `claudesworth-bot`
- Working directory: `~/GitHub/tools/discord-task-bot`
- Start command: `npm run dev`
- Auto-start: Yes (when orchestrator starts)

**Option B: Create dedicated "Services" workspace**
- New workspace for background services
- Contains: Claudesworth bot, future services
- Separate from project worktrees

Status: **Shipped** (Services workspace auto-created on demand via `POST /api/discord/ensure-services`).

### 2. Add Dedicated Claude Code Session for Queue Processing

Create a Claude Code terminal that:
- Name: `claudesworth-processor` or `discord-queue-processor`
- Purpose: Process queued Discord tasks
- Auto-start: Optional (can be started on demand)
- Working directory: `~` (home, so it has access to everything)

This session should have context about:
- Where queue files are: `~/.claude/discord-queue/`
- Trello board IDs (from `~/.claude/TRELLO_BOARDS.md`)
- How to check for duplicates before creating cards

### 3. Orchestrator API Endpoint for Queue Processing

The bot already calls:
```
POST http://localhost:9460/api/commander/send-to-session
{
  "sessionId": "...",
  "input": "check discord queue...\r"
}
```

Ensure there's a session available. Options:
- Bot finds any available Claude session (current behavior)
- Bot targets a specific session ID (e.g., `discord-queue-processor`)
- New endpoint: `POST /api/discord/process-queue` that handles session selection

Status: **Shipped** (`POST /api/discord/process-queue`).

### 4. UI Updates (Optional)

Show in orchestrator UI:
- Discord bot status (running/stopped)
- Queue count badge
- Recent Discord activity feed

## Implementation Steps

### Step 1: Add Bot Terminal to Orchestrator

In the workspace/terminal configuration, add:

```json
{
  "id": "claudesworth-bot",
  "name": "Claudesworth",
  "type": "service",
  "cwd": "~/GitHub/tools/discord-task-bot",
  "command": "npm run dev",
  "autoStart": true,
  "icon": "🤖"
}
```

### Step 2: Add Queue Processor Session

Add a Claude Code terminal configured to handle queue processing:

```json
{
  "id": "discord-queue-processor",
  "name": "Discord Queue Processor",
  "type": "claude",
  "cwd": "~",
  "autoStart": false,
  "icon": "📥"
}
```

### Step 3: Update Bot's Orchestrator Service

In `~/GitHub/tools/discord-task-bot/src/services/orchestrator.ts`:

Change the session targeting logic to prefer `discord-queue-processor`:

```typescript
// Instead of finding any session, target specific one
const TARGET_SESSION_ID = 'discord-queue-processor';

export async function triggerQueueProcessing() {
  // Try dedicated session first
  const sent = await sendToSession(TARGET_SESSION_ID, command);
  if (!sent) {
    // Fall back to any available session
    const sessions = await getSessions();
    // ... existing logic
  }
}
```

### Step 4: Add Startup Script

Create script that starts both bot and processor session:

```bash
#!/bin/bash
# start-discord-integration.sh

# Start the bot terminal
curl -X POST http://localhost:9460/api/terminals/start \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "claudesworth-bot"}'

# Start the processor session (optional)
curl -X POST http://localhost:9460/api/terminals/start \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "discord-queue-processor"}'
```

## Constraints

1. **No MCP** - Do not use Model Context Protocol. Use direct API calls and scripts.

2. **Use Max Subscription** - Queue processing should go through Claude Code CLI, not Claude API, to use the Max subscription.

3. **Bot Must Stay Simple** - The Discord bot itself should NOT call Claude API. It either:
   - Creates Trello cards directly (pattern matching, no AI)
   - Queues tasks for Claude Code to process

4. **Prompt Injection Protection** - User input from Discord is UNTRUSTED:
   - Never pass raw Discord messages to shell commands
   - Use `jq -Rs` for JSON encoding
   - Validate board/list IDs against whitelist
   - Reject suspicious characters: `$()`, backticks, `|`, `&`, `;`

5. **Duplicate Detection** - Before creating any Trello card, check existing cards on the board for duplicates.

6. **Port 9460 Reserved** - Orchestrator runs on port 9460. Never kill it.

## File References

| File | Purpose |
|------|---------|
| `~/GitHub/tools/discord-task-bot/` | Bot source code |
| `~/GitHub/tools/discord-task-bot/.env` | Bot credentials (gitignored) |
| `~/.claude/discord-queue/pending-tasks.json` | Queued tasks |
| `~/.claude/discord-queue/recent-messages.json` | Dumped messages |
