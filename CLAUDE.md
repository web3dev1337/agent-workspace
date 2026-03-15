# Claude Orchestrator Guidelines for Claude Code

🚨 **READ THIS ENTIRE FILE** 🚨
**CRITICAL: You MUST read this complete file from start to finish. Do not truncate or skip sections.**

*Note: This is a revolutionary multi-workspace orchestrator for managing unlimited Claude Code sessions with mixed-repository support, dynamic worktree creation, and zero-friction workflows.*

## 🚨 IMPORTANT: ALWAYS PROVIDE PR URL 🚨
**When creating any pull request, ALWAYS provide the PR URL in your response to the user. This is mandatory for all PRs.**

## Resume / Context Reset (read this if you lose context)

If you ever lose context mid-run, do **not** improvise. Resume from these files:

- `PLANS/2026-01-20/REQUESTED_CHANGES.md` (master list of requested fixes)
- `PLANS/2026-01-20/ROLLING_LOG.md` (what shipped; PR links; where to resume)
- `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md` (tier + queue model)
- `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md` (current open items: tiers, risk, prompts, review inbox)
- `PLANS/2026-01-25/BRAIN_DUMP_2026-01-25.md` (full workflow brain dump transcript)
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md` (what’s missing + next PRs)
- `PLANS/2026-01-25/DATA_MODEL.md` (where tiers/deps/prompts live)

Current open PRs (keep updated in the rolling log):
- None (check with `gh pr list --state open`)

## Process workflow controls (Commander + voice)

Commander/voice can drive the tiered workflow via semantic commands:
- `set-workflow-mode` (`focus|review|background`)
- `set-focus-tier2` (`auto|always`)
- `open-queue`, `open-tasks`, `open-advice`

Tier tagging persistence:
- stored in `~/.orchestrator/task-records.json` via `session:<id>` task records
- loaded on page refresh via `GET /api/process/task-records`

## Launching Agents from Trello

### Board-to-Repo Mapping
**CRITICAL:** Always check `~/.claude/TRELLO_BOARDS.md` for the full board/list/repo mapping. Do NOT assume a board maps to a specific repo - look it up!

| Board | Board ID | Repo Path | Repo Type |
|-------|----------|-----------|-----------|
| Zoo Hytopia | `691e5516c77f3e9c9fd89f61` | `~/GitHub/games/hytopia/zoo-game/` | `hytopia-game` |
| Arcade World | `694a07bae349c125d4568094` | `~/GitHub/games/hytopia/games/hytopia-2d-game-test/` | `hytopia-game` |

Each board has its own **AB T3 Que**, **Doing**, and **Test** lists - IDs differ per board. Always look up the correct list ID from `TRELLO_BOARDS.md`.

**Get card with agent field:**
```bash
# Get card details
bash ~/.claude/scripts/trello-get.sh card CARD_ID | jq '{name, desc}'
# Get agent field (Claude=<TRELLO_FIELD_OPTION_ID_CLAUDE>, Codex=<TRELLO_FIELD_OPTION_ID_CODEX>)
curl -sS "https://api.trello.com/1/cards/CARD_ID/customFieldItems?key=$KEY&token=$TOKEN" | jq -r '.[0].idValue'
```

**Prompt must include (NEVER truncate!):**
1. **Title:** Full card name
2. **Description:** ENTIRE card description - user wrote detailed prompts there!
3. **Workflow:** git checkout, commit/push, tests, PR

**Launch commands:**
- Codex: `codex --dangerously-bypass-approvals-and-sandbox`
- Claude: `claude --dangerously-skip-permissions`

**Launch sequence (MUST follow):**
0. **CHECK ACTIVE WORKSPACE FIRST**: `GET /api/workspaces/active` — add worktrees to the workspace the user has open, NOT a random one
1. Remove all worktrees: `POST /api/workspaces/remove-worktree` for each
2. Re-add worktrees with tier: `POST /api/workspaces/add-mixed-worktree` (include `startTier`)
3. Start agent: send launch command + `\r`
4. Wait 3 seconds
5. **Accept the `--dangerously-skip-permissions` prompt**: Claude now shows a confirmation prompt on launch — send `1` + `\r` to accept it, then wait 2 seconds for Claude to fully initialize
6. Send FULL prompt (title + ENTIRE description + workflow)
7. Send `\r` to submit
7. Move Trello card to Doing list

**Add worktree with tier:**
```bash
curl -sS -X POST http://localhost:$PORT/api/workspaces/add-mixed-worktree \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "zoo-shrimp-game",
    "repositoryPath": "/path/to/repo",
    "repositoryType": "hytopia-game",
    "repositoryName": "zoo-game",
    "worktreeId": "work1",
    "startTier": 3
  }'
# startTier: 1=T1 (focus), 2=T2 (review), 3=T3 (background), 4=T4 (lowest)
```

**Link Trello card to session (task record):**
```bash
curl -sS -X PUT "http://localhost:$PORT/api/process/task-records/session:zoo-game-work1-claude" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": 3,
    "ticketProvider": "trello",
    "ticketCardId": "CARD_ID",
    "ticketBoardId": "BOARD_ID",
    "ticketCardUrl": "https://trello.com/c/SHORTLINK",
    "ticketTitle": "Card title here"
  }'
```

**Common mistakes to avoid:**
- NEVER truncate/summarize descriptions - user wrote detailed prompts!
- ALWAYS check agent field BEFORE launching (Codex vs Claude)
- Stop-session doesn't fully clear - use remove-worktree + re-add
- Sessions are paired (claude+server) - remove both via worktree

### Trello → Codex Batch Launch Process

When user says "launch all cards from [list] as Codexes":

**1. Get the correct list ID:**
```bash
KEY=$(awk -F= '/^TRELLO_API_KEY=/{print $2}' ~/.trello-credentials | tr -d '\r\n[:space:]')
TOKEN=$(awk -F= '/^TRELLO_TOKEN=/{print $2}' ~/.trello-credentials | tr -d '\r\n[:space:]')
curl -fsS "https://api.trello.com/1/boards/BOARD_ID/lists?key=${KEY}&token=${TOKEN}" | jq -r '.[] | "\(.id) | \(.name)"'
```

**2. Get ALL cards with FULL descriptions:**
```bash
curl -fsS "https://api.trello.com/1/lists/LIST_ID/cards?key=${KEY}&token=${TOKEN}&fields=id,name,desc" > /tmp/trello-cards.json
# Verify desc lengths (list endpoint may truncate):
jq -r '.[] | {name: .name[0:60], desc_len: (.desc | length)}' /tmp/trello-cards.json
```

**3. Add worktrees to current workspace:**
```bash
for i in $(seq 1 N); do
  curl -sS -X POST "http://localhost:$PORT/api/workspaces/add-mixed-worktree" \
    -H "Content-Type: application/json" \
    -d '{"workspaceId": "WORKSPACE", "repositoryPath": "REPO_PATH", "repositoryType": "hytopia-game", "repositoryName": "REPO_NAME", "worktreeId": "work'$i'", "startTier": 3}'
done
```

**4. For each card, launch Codex then send prompt:**
```bash
SESSION_ID="REPONAME-workN-claude"
# Launch Codex
curl -sS -X POST "http://localhost:$PORT/api/commander/send-to-session" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"input\": \"\u0015codex -m gpt-5.3-codex -c model_reasoning_effort=xhigh --dangerously-bypass-approvals-and-sandbox\"}"
sleep 1
curl -sS -X POST "http://localhost:$PORT/api/commander/send-to-session" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"input\": \"\r\"}"
sleep 3  # wait for Codex init (only needs 2-3s)

# Send VERBATIM title + desc + system instructions AFTER
PROMPT="${CARD_TITLE}\n\n${CARD_DESC}\n\n---\nSYSTEM INSTRUCTIONS:\n1. git fetch origin master && git checkout master && git pull\n2. git checkout -b feature/BRANCH_SLUG\n3. Read CLAUDE.md and CODEBASE_DOCUMENTATION.md first\n4. Implement everything above verbatim\n5. Clean surgical code, minimal diff\n6. Automated tests following existing patterns\n7. NEVER squash merge\n8. Commit and push regularly\n9. gh pr create when done, include PR link\n10. Run existing tests"

curl -sS -X POST "http://localhost:$PORT/api/commander/send-to-session" \
  -H "Content-Type: application/json" \
  --data-binary @- << EOF
{"sessionId": "$SESSION_ID", "input": $(echo "$PROMPT" | jq -Rs .)}
EOF
sleep 1
curl -sS -X POST "http://localhost:$PORT/api/commander/send-to-session" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"input\": \"\r\"}"
```

**Batch launch key rules:**
- NEVER summarize card title or description - paste VERBATIM
- Use `gpt-5.3-codex` model with `xhigh` reasoning
- System instructions go AFTER the card content
- Two-request pattern: text first, then `\r` separately
- 3s sleep for Codex init (it initializes in ~2-3s, not 15)
- Use `\u0015` (Ctrl+U) before Codex command to clear line
- **Claude `--dangerously-skip-permissions` acceptance**: After launching Claude, send `1` + `\r` to accept the confirmation prompt, then wait 2s before sending the task prompt

## Codex CLI Reference

### Launch commands
- Claude: `claude --dangerously-skip-permissions`
- Codex: `codex --dangerously-bypass-approvals-and-sandbox`
- Codex with explicit model: `codex -m gpt-5.3-codex -c model_reasoning_effort=xhigh --dangerously-bypass-approvals-and-sandbox`

### Codex Upgrade Issues

**ENOTEMPTY error on npm upgrade:**
```bash
rm -rf ~/.nvm/versions/node/v24.9.0/lib/node_modules/@openai/codex && npm i -g @openai/codex@latest
```

**"Model does not exist" errors** — Codex needs upgrading:
```bash
npm i -g @openai/codex@latest
```

### Codex config location
- Config: `~/.codex/config.toml`
- Global instructions: `~/.codex/AGENTS.md`
- Fallback filenames (set in config): reads `CLAUDE.md` if no `AGENTS.md`

## 🚨 STOP! DO THIS FIRST BEFORE ANYTHING ELSE! 🚨

### THE VERY FIRST THING YOU MUST DO (NO EXCEPTIONS):
```bash
git fetch origin --prune
git checkout -b fix/your-feature-name origin/main
```

**NOTE (worktrees):** This repo commonly runs as **two git worktrees**:
- `~/GitHub/tools/automation/claude-orchestrator/master` (your daily “production” instance)
- `~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev` (development)

Because `main` is usually checked out in the `master/` worktree, **do not try to check out `main` inside `claude-orchestrator-dev/`** (Git will error: “branch 'main' is already used by worktree…”). Always branch from `origin/main` in dev.

**CRITICAL SAFETY:** If you are working in `claude-orchestrator-dev/`, **do not edit, pull, or run commands in the `master/` folder** unless explicitly requested — that instance may be running on port **3000**.

**ALSO CRITICAL:** If Commander Claude is running FROM `master/`, **NEVER edit files in `master/`**. Even if you revert changes, nodemon will detect the file change and restart the production server, which crashes all active sessions. ALL code changes go in `claude-orchestrator-dev/` on a feature branch, then PR into main. The ONLY exception is if the user explicitly asks you to edit production.

**TEST SAFETY (ports):**
- Never use port `3000` for dev/test runs.
- Use `npm run test:e2e:safe` (defaults to a dedicated port) for Playwright.

**DO NOT**:
- ❌ Read any files first
- ❌ Plan tasks first  
- ❌ Use TodoWrite first
- ❌ Do ANYTHING else first

**ALWAYS** run these git commands IMMEDIATELY when starting ANY work!

## 🚨 CRITICAL: READ THESE FILES 🚨
**2. Read `CODEBASE_DOCUMENTATION.md`** - Contains system docs and file locations (READ THE ENTIRE FILE)

## 🚨 CRITICAL: ALWAYS CREATE A PR WHEN DONE 🚨
**When you complete ANY feature or fix, you MUST create a pull request using `gh pr create`. This is mandatory. Add "Create PR" as your final checklist item to ensure you never forget.**

## Git Workflow Notes
- Always work on fresh branches from updated main
- If `git fetch origin main:main` fails, use `git fetch origin main && git checkout -b feature/name origin/main`
- Never provide delivery estimates in weeks; provide dependency-ordered execution slices instead.

## Code Style Guidelines

### UI/UX Rules
- Never darken the background when a modal is open.

### Node.js Standards
- Follow existing patterns in the codebase
- **Always prefer parameters over magic numbers** - use constants or config
- **Use JSON files for configuration** - prefer config files over hardcoded values

### Orchestrator Patterns
- Use singleton pattern for managers (SessionManager, StatusDetector, etc.)
- Event-driven communication via Socket.IO
- Clean code, simpler is better where possible

### Import/Module Verification
- **New files**: Verify with `ls` after Write tool
- **Imports**: Use `find` to check file exists before importing  
- **Methods**: Use `rg "methodName.*\("` to verify method exists before calling
- **Quick check**: `node --check server/index.js` to catch syntax errors

## Testing Requirements
- Do a quick sanity check before creating PR:
  - `node --check server/index.js` (catch syntax errors)
  - Test the specific feature manually

## Architecture Notes

### Key Systems
- **Server**: Express.js backend with Socket.IO (`server/index.js`)
- **SessionManager**: Terminal session management (`server/sessionManager.js`)
- **StatusDetector**: Claude Code session monitoring (`server/statusDetector.js`)
- **GitHelper**: Git operations and branch management (`server/gitHelper.js`)
- **WorkspaceManager**: Multi-workspace orchestration (`server/workspaceManager.js`)
- **WorktreeHelper**: Git worktree operations (`server/worktreeHelper.js`)
- **NotificationService**: System notifications (`server/notificationService.js`)
- **CommanderService**: Top-Level AI orchestration terminal (`server/commanderService.js`)
- **CommandHistoryService**: Terminal autosuggestions via shell history (`server/commandHistoryService.js`)
- **Tauri App**: Native desktop application (`src-tauri/`)
- **Diff Viewer**: Advanced code review tool (`diff-viewer/`)

## Commander Claude (Top-Level AI)

Commander Claude is a special Claude Code instance that runs from the orchestrator `master/` directory with knowledge of the entire system. When you ARE Commander Claude (running in this directory or launched from the Commander panel), you have these capabilities.

**IMPORTANT:** When you first start, greet the user with:
> Commander Claude reporting for duty, sir!

**Read the full Commander instructions:**
```bash
cat ~/GitHub/tools/automation/claude-orchestrator/master/docs/COMMANDER_CLAUDE.md
```

### Port Detection (MANDATORY — do this first)

The orchestrator port is NOT hardcoded. It comes from `.env` in your working directory:
```bash
PORT=$(grep ORCHESTRATOR_PORT .env | cut -d= -f2)
# Production (master/) = typically 3000, Dev = typically 4000
# All API examples below use $PORT — resolve it before running commands
```

**All `curl` examples in this file use `$PORT`.** Never assume 3000 or 4000.

### What Commander Can Do
1. **View All Sessions**: See all active Claude sessions across all workspaces
   - API: `GET /api/commander/sessions`
2. **Send Commands to Sessions**: Write input to any running session
   - API: `POST /api/commander/send-to-session` with `{ sessionId, input }`
3. **Orchestrate Work**: Coordinate tasks across multiple Claude instances
4. **Access Project Information**: Read workspace configs and status

### Commander API Endpoints
```bash
# Check Commander status
GET /api/commander/status

# Start/Stop/Restart Commander terminal
POST /api/commander/start
POST /api/commander/stop
POST /api/commander/restart

# Start Claude in Commander (yolo mode by default)
POST /api/commander/start-claude  { mode: 'fresh'|'continue'|'resume', yolo: true }

# Send input to Commander terminal
POST /api/commander/input  { input: "text to send" }

# Get active workspace (which workspace the UI is showing)
GET /api/workspaces/active
# Returns: { id: "workspace-id", name: "Workspace Name" }
# Falls back to persisted config if in-memory state is null

# View all sessions — returns {"sessions":[...]} NOT bare array!
GET /api/commander/sessions
# jq: use '.sessions[]' not '.[]'

# Send to another session
POST /api/commander/send-to-session  { sessionId: "...", input: "..." }

# System Recommendations (missing tools, suggested installs)
GET  /api/recommendations              # returns {"items":[...]}
POST /api/recommendations              # {"package","reason","installCmd","category"}
PATCH /api/recommendations/:id         # {"status":"installed"|"dismissed"}
DELETE /api/recommendations/:id        # remove entirely
```

### Logging Missing Tools
When a command fails with "not found", POST a recommendation so the user sees it in the UI 🔧 badge:
```bash
curl -sS -X POST http://localhost:$PORT/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{"package":"dos2unix","reason":"CRLF fix for WSL scripts","installCmd":"sudo apt-get install -y dos2unix","category":"apt"}'
```

### Quick Orchestrator Commands

**Focus a Worktree** (show only one worktree's terminals):
```bash
curl -sS -X POST http://localhost:$PORT/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "focus-worktree", "params": {"worktreeId": "work1"}}'
```

**Show All Worktrees** (unfocus/reset view):
**NOTE:** The `show-all-worktrees` API command is BROKEN (calls non-existent method).
Use the "View All" button in the UI (bottom-left under worktrees list) instead.

**Highlight a Worktree** (visual highlight without hiding others):
```bash
curl -sS -X POST http://localhost:$PORT/api/commander/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "highlight-worktree", "params": {"worktreeId": "work1"}}'
```

**List All Workspaces:**
```bash
curl -sS http://localhost:$PORT/api/workspaces | jq '.[].name'
```

**Get Workspace Details** (including worktrees):
```bash
curl -sS http://localhost:$PORT/api/workspaces | jq '.[] | select(.name == "Zoo Game")'
```

**Switch to Different Workspace:**
Use Socket.IO event `switch-workspace` with `workspaceId` - handled via the UI primarily.

**Add Worktree to Workspace** (CORRECT API FORMAT):
**DO NOT use `path` or `worktreePath`** - the API expects these specific parameters:
```bash
curl -sS -X POST http://localhost:$PORT/api/workspaces/add-mixed-worktree \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "workspace-id",
    "repositoryPath": "/home/<user>/GitHub/games/hytopia/zoo-game",
    "repositoryType": "hytopia-game",
    "repositoryName": "zoo-game",
    "worktreeId": "work1",
    "startTier": 3
  }'
```
The worktreePath is computed internally as `repositoryPath + worktreeId`.

### Project Workspaces Location
Workspaces are stored in `~/.orchestrator/workspaces/`. Each workspace has:
- `config.json`: Workspace configuration
- Terminal assignments and repository mappings

### Common Orchestration Tasks
- **Broadcast a message**: Loop through sessions and send to each
- **Check project status**: Read worktree git status via sessions
- **Coordinate builds**: Trigger builds across multiple projects

### Important Files to Read First
- `CODEBASE_DOCUMENTATION.md`: Comprehensive system overview
- `docs/COMMANDER_CLAUDE.md`: Commander AI API reference
- `server/index.js`: Main backend entry point
- `package.json`: Dependencies and scripts
- `src-tauri/src/main.rs`: Tauri app entry point

### Project Components
- **Multi-Workspace System**: Dynamic workspace management with mixed-repo support
- **Multi-Terminal Management**: Configurable terminal grid (default 16 terminals)
- **Native Desktop App**: High-performance Tauri-based application
- **Advanced Diff Viewer**: Web-based code review with AI analysis
- **Real-time Communication**: Socket.IO for live updates
- **Worktree Integration**: Seamless git worktree creation and management

## Workspace Management

### Key Concepts
- **Single-repo workspaces**: Traditional one-repository-per-workspace
- **Mixed-repo workspaces**: Multiple repositories in one workspace via worktrees
- **Templates**: Predefined workspace configurations in `templates/launch-settings/`
- **User Settings**: Personal preferences stored in `user-settings.json`

### Working with Workspaces
- Workspace configurations are stored in `~/.orchestrator/workspaces/`
- Each workspace can have different terminal counts and repository setups
- Mixed-repo workspaces automatically create worktrees in project directories
- Templates provide consistent setups for different project types

### Important Workspace Files
- `server/workspaceManager.js`: Core workspace operations
- `server/workspaceSchemas.js`: Configuration validation
- `server/worktreeHelper.js`: Git worktree integration
- `client/workspace-wizard.js`: UI for workspace creation

## Tabbed Workspace System (NEW)

### Overview
The orchestrator now supports **browser-like tabs** for working with multiple workspaces simultaneously. Each tab maintains its own complete state including terminals, sessions, and UI.

### Using Tabs

**Opening Multiple Workspaces:**
- Click the **+** button in the tab bar to open a new workspace
- Each workspace opens in a separate tab
- Tabs persist their complete state when switching

**Switching Between Tabs:**
- **Click** any tab to switch to it
- **Alt+←** / **Alt+→** - Navigate to previous/next tab
- **Alt+1-9** - Jump directly to tab 1-9
- **Alt+N** - Open new workspace tab
- **Alt+W** - Close current tab

**Tab Features:**
- Terminal content fully preserved when switching tabs
- Notification badges show activity in background tabs (e.g., "Epic Survivors (3)")
- Each tab has its own sidebar showing that workspace's worktrees
- Terminals continue running in background tabs
- No visual glitches or layout shifts when switching

### Architecture Notes

**State Isolation:**
Each tab maintains complete isolation with its own:
- Terminal instances (XTerm.js) and scrollback buffers
- Session data (branch info, status, etc.)
- Sidebar worktree list
- Scroll positions and cursor positions

**State Swapping:**
When switching tabs, the system swaps state between tabs:
1. **Hide tab:** Save terminals/sessions from global manager → tab storage
2. **Show tab:** Restore terminals/sessions from tab storage → global manager

This ensures each tab sees only its own data without cross-contamination.

**Critical Implementation:**
- Terminals are NEVER destroyed on visibility toggle (use CSS display instead)
- XTerm instances stay attached to same DOM elements
- Global `terminalManager.terminals` is swapped per tab
- `orchestrator.sessions` is swapped per tab

### Common Gotchas

1. **Don't destroy terminal DOM elements** - Use `display: none` instead of `innerHTML = ''`
2. **State must be swapped** - Can't rely on global state persisting across tabs
3. **Each tab needs its own container** - Use `getTerminalGrid()` to get correct container
4. **Tab ID must be set before creating terminals** - So they register to correct tab

## Cascaded Configuration System

### Overview
The orchestrator uses a 5-layer cascading configuration system that allows project-specific button configurations, game modes, and common flags to be defined at different hierarchy levels and merged intelligently.

### Configuration Hierarchy (Priority: Bottom → Top)
1. **Global**: `~/GitHub/.orchestrator-config.json`
2. **Category**: `~/GitHub/games/.orchestrator-config.json`
3. **Framework**: `~/GitHub/games/hytopia/.orchestrator-config.json`
4. **Project**: `~/GitHub/games/hytopia/games/HyFire2/.orchestrator-config.json`
5. **Worktree**: `~/GitHub/games/hytopia/games/HyFire2/work1/.orchestrator-config.json` (highest priority)

### Configuration File Structure
```json
{
  "buttons": {
    "claude": {
      "review": {
        "label": "Review",
        "command": "gh pr view --web",
        "description": "Open PR in browser"
      }
    },
    "server": {
      "play": {
        "label": "Play",
        "command": "npm run dev -- {{gameMode}} {{commonFlags}}",
        "description": "Start game server"
      }
    }
  },
  "gameModes": {
    "deathmatch": {
      "flag": "--mode=deathmatch",
      "label": "Deathmatch"
    }
  },
  "commonFlags": {
    "unlockAll": {
      "flag": "--unlock-all",
      "label": "Unlock All"
    }
  }
}
```

### How Configs Merge
- **Buttons**: Deep merge by terminal type (claude/server) and button ID
- **Game Modes**: Object merge - child overrides parent with same key
- **Common Flags**: Object merge - child overrides parent with same key
- **Arrays**: Child completely replaces parent (no array merge)
- **Primitives**: Child overrides parent

### Using Cascaded Configs

#### API Endpoint
```bash
# Get base config for a repository type
GET /api/cascaded-config/:type

# Get config with worktree overrides
GET /api/cascaded-config/:type?worktreePath=/path/to/worktree
```

#### In Code
```javascript
// Get base cascaded config
const config = workspaceManager.getCascadedConfigBase('hytopia-game');

// Get config with worktree-specific overrides
const worktreeConfig = await workspaceManager.getCascadedConfigForWorktree(
  'hytopia-game',
  '/home/user/GitHub/games/hytopia/games/HyFire2/work1'
);
```

### Key Implementation Details
- **Config Discovery**: `server/configDiscoveryService.js` automatically scans file hierarchy for `.orchestrator-config.json` files
- **Deep Cloning**: All configs are deep cloned before merging to prevent cache mutation
- **Error Handling**: Missing config files at any level are gracefully handled (no crashes)
- **Cache Prevention**: Uses `JSON.parse(JSON.stringify())` to ensure cached configs aren't mutated
- **Undefined Handling**: mergeConfigs uses `{ ...(result[key] || {}), ...override[key] }` pattern to safely handle undefined values

### Common Gotchas
1. **Config Mutation**: Always deep clone before merging - shallow spread operators (`{ ...obj }`) still share nested references
2. **Undefined Spread**: Use `|| {}` when spreading to handle undefined gameModes/commonFlags
3. **Master Directory Discovery**: For worktree-based projects, configs are discovered in `master/` subdirectory
4. **Terminal-Specific Buttons**: Each terminal type (claude/server) has its own button namespace
5. **Array Replacement**: Unlike objects, arrays don't merge - child completely replaces parent array

## Common Commands
```bash
# Development
npm run dev
npm run tauri:dev

# Tauri desktop builds
npm run tauri:build           # Release build (slow, optimized, small binary — for distribution)
npm run tauri:build:fast      # Fast build (~3-5x faster — for local testing/iteration)
# Single installer format only (even faster):
#   node scripts/tauri/prepare-backend-resources.js --install-prod && tauri build -b nsis -- --profile fast

# Testing
node --check server/index.js

# Workspace migration (if needed)
node scripts/migrate-to-workspaces.js
```

### Tauri Build Profiles
- **`release`** (default `tauri:build`): `lto=true`, `codegen-units=1`, `opt-level="s"` — smallest binary, slowest compile. Use for distribution/CI.
- **`fast`** (`tauri:build:fast`): `lto=false`, `codegen-units=256`, `incremental=true` — ~3-5x faster compile. Use for local dev/testing.

### Local Tauri Build Prerequisites
```bash
# 1. Rust (no sudo)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"

# 2. System libs (Ubuntu 24.04+ / WSL)
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libayatana-appindicator3-dev
# Ubuntu 22.04: use libwebkit2gtk-4.0-dev instead of 4.1

# 3. Build
npm run tauri:build:fast
# WSL: AppImage fails (no FUSE) — use deb-only instead:
#   npx tauri build -b deb -- --profile fast
```
First build ~43s, rebuilds ~2-3s (incremental). Needs ~3-5 GB disk.

## Performance Considerations
- Native app provides 10-20x faster startup vs browser
- Use object pooling for frequently created objects
- Limit socket event frequency for performance
- Cache frequently accessed data (session states, git info)

## When Adding New Features

### REMINDER - YOU MUST HAVE ALREADY DONE THIS:
If you haven't already run these commands, STOP and do it NOW:
```bash
git fetch origin main:main
git checkout -b feature/new-feature main
```

### Then follow these steps:
1. ✅ Already done: You've fetched main and created a new branch
2. Check existing similar implementations
3. Follow established patterns (service-based architecture)
4. Commit and push often
5. **Update documentation if adding new files/systems**: Update CODEBASE_DOCUMENTATION.md in a SEPARATE commit BEFORE the main work
6. Test the feature thoroughly
7. **Remove debug logs**: Remove any temporary debug logging added for this specific feature/bug
8. **Run final checks**: lint, syntax check, and manual testing
9. **BEFORE creating a pull request**: Update `CODEBASE_DOCUMENTATION.md` if you have added any new files or systems
10. **ALWAYS create a PR when done**: Once all changes are committed and pushed, create a pull request using `gh pr create`

### Creating Pull Requests (ALWAYS DO THIS):
```bash
# Push your branch if not already pushed
git push -u origin your-branch-name

# Create PR with descriptive title and body
gh pr create --title "feat: brief description" --body "$(cat <<'EOF'
## Summary
- What was added/fixed
- Key changes made

## Test plan
- How to test the changes
- Expected behavior

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

### Multi-Component Development Strategy
🚨 **CRITICAL**: For related features across components (server/client/tauri), always work on the SAME branch and create ONE PR

#### **When to Use SINGLE Branch + PR:**
- Related features across server/client/tauri
- Building on previous work in same session
- Adding enhancements to existing feature
- Bug fixes + improvements for same system

#### **Single Branch Workflow (PREFERRED):**
```bash
git checkout -b feature/complete-feature-name main
# Phase 1: Backend changes
git add . && git commit -m "phase 1: backend implementation"
# Phase 2: Frontend changes  
git add . && git commit -m "phase 2: frontend integration"
# Phase 3: Native app updates
git add . && git commit -m "phase 3: native app support"
# ONE PR with all phases
git push -u origin feature/complete-feature-name
gh pr create --title "Complete feature with all components"
```

## Critical Patterns

```
SINGLETONS:   SessionManager.getInstance(), service managers
EVENTS:       Socket.IO events for real-time communication
GLOBALS:      process.env for configuration, global logger
DEBUG:        Winston logger with multiple levels and files
CONFIG:       config.json for shared settings, .env for secrets
SERVICES:     Modular service architecture with clear interfaces
```

## Common Gotchas

1. Socket.IO CORS settings must include all client origins
2. Native app requires different handling than web clients
3. File watching can be resource intensive - use debouncing
4. All managers use singleton pattern for consistency
5. Git operations should be async and error-handled
6. Logs should use Winston logger, not console.log
7. **Be careful with `pkill -f` commands** - avoid broad patterns that could kill WSL or Claude Code itself
8. **node-pty segfaults**: Run `npm rebuild node-pty` if server crashes with segmentation fault
9. **Workspace switching**: Clean up all sessions before switching to prevent orphaned processes
10. **Worktree paths**: Validate worktree paths to avoid conflicts with existing directories
11. **Mixed-repo terminal naming**: Use consistent patterns to avoid terminal ID conflicts
12. **Workspace templates**: Always validate against schemas to prevent invalid configurations
13. **Config cache mutation**: Always deep clone configs before merging - use `JSON.parse(JSON.stringify())` not shallow spread
14. **Undefined config spread**: Handle missing gameModes/commonFlags with `{ ...(result[key] || {}), ...override[key] }` pattern
15. **XTerm rendering race**: Wrap fitTerminal() in requestAnimationFrame() to allow renderer initialization
16. **Repository name extraction**: For mixed-repo workspaces, use workspace config's terminal.repository.name, not session ID parsing
17. **ALWAYS check active workspace first**: Before adding worktrees or launching agents, call `GET /api/workspaces/active` to find which workspace the user currently has open. Add worktrees to THAT workspace — never guess or pick a workspace by name
18. **`remove-worktree` nukes ALL repos with matching worktreeId**: `POST /api/workspaces/remove-worktree` with just `worktreeId: "work1"` removes EVERY repo's work1 in the workspace. **ALWAYS scope with `repositoryName`** to remove only the intended repo's worktree

## Development Setup - Two Isolated Instances

### Why Two Instances?
To avoid conflicts when developing the Orchestrator itself while using it for other work.

### 🎯 COMPLETE SETUP FOR NEW TEAM MEMBERS:

**Full installation (Production + Dev instances):**

```bash
# 1. Production instance (port 3000)
git clone https://github.com/web3dev1337/claude-orchestrator.git ~/GitHub/tools/automation/claude-orchestrator/master
cd ~/GitHub/tools/automation/claude-orchestrator/master

cat > .env << 'EOF'
ORCHESTRATOR_PORT=3000
CLIENT_PORT=2080
TAURI_DEV_PORT=1420
DIFF_VIEWER_PORT=7655
LOG_LEVEL=info
NODE_ENV=development
ENABLE_FILE_WATCHING=true
EOF

npm install
cd diff-viewer && npm install && cd ..

# 2. Dev instance (port 4000)
git clone https://github.com/web3dev1337/claude-orchestrator.git ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev
cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev

cat > .env << 'EOF'
ORCHESTRATOR_PORT=4000
CLIENT_PORT=2081
TAURI_DEV_PORT=1421
DIFF_VIEWER_PORT=7656
LOG_LEVEL=info
NODE_ENV=development
ENABLE_FILE_WATCHING=true
EOF

npm install
cd diff-viewer && npm install && cd ..
```

### 🎯 RUNNING THE INSTANCES:

#### Production Instance (Your Daily Work):
```bash
cd ~/GitHub/tools/automation/claude-orchestrator/master
npm start           # Runs on ports 3000/2080/7655
```

#### Development Instance (Modifying the Orchestrator):
```bash
cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev
npm start           # Runs on ports 4000/2081/7656
```

### Quick Reference:

| Purpose | Directory | Command | Ports | Use Case |
|---------|-----------|---------|-------|----------|
| **Production** | ~/GitHub/tools/automation/claude-orchestrator/master | `npm start` | 3000/2080/7655 | Your daily Claude work |
| **Development** | ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev | `npm start` | 4000/2081/7656 | Modifying Orchestrator |

### What Gets Started:
All commands run these 4 services:
- **Server** (Express backend with hot-reload)
- **Client** (Web UI dev server)
- **Tauri** (Native desktop app)
- **Diff Viewer** (PR review tool on port 7655 for prod, 7656 for dev)

### Important Notes:
- **DO NOT touch the production `master/` instance when developing:** if you’re working in `claude-orchestrator-dev/` (feature branches / PRs), treat `~/GitHub/tools/automation/claude-orchestrator/master` as **run-only**. Do all code changes + commits in `claude-orchestrator-dev/`, then open PRs into `main`. Only `git pull` in `master/` when you explicitly want to update the running production copy.
- Both instances can run simultaneously without conflicts
- The `.env` files control which ports are used
- `npm start`, `npm run dev`, and `npm run prod` are all equivalent
- Each instance needs its own `node_modules` and `diff-viewer/node_modules`

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨
