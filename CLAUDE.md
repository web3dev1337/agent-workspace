# Claude Orchestrator Guidelines for Claude Code

🚨 **READ THIS ENTIRE FILE** 🚨
**CRITICAL: You MUST read this complete file from start to finish. Do not truncate or skip sections.**

*Note: This is a revolutionary multi-workspace orchestrator for managing unlimited Claude Code sessions with mixed-repository support, dynamic worktree creation, and zero-friction workflows.*

## 🚨 IMPORTANT: ALWAYS PROVIDE PR URL 🚨
**When creating any pull request, ALWAYS provide the PR URL in your response to the user. This is mandatory for all PRs.**

## 🚨 STOP! DO THIS FIRST BEFORE ANYTHING ELSE! 🚨

### THE VERY FIRST THING YOU MUST DO (NO EXCEPTIONS):
```bash
git fetch origin main:main
git checkout -b fix/your-feature-name main
```

**DO NOT**:
- ❌ Read any files first
- ❌ Plan tasks first  
- ❌ Use TodoWrite first
- ❌ Do ANYTHING else first

**ALWAYS** run these git commands IMMEDIATELY when starting ANY work!

## 🚨 CRITICAL: READ THESE FILES 🚨
**2. Read `CODEBASE_DOCUMENTATION.md`** - Contains system docs and file locations (READ THE ENTIRE FILE)
**3. Read `COMPLETE_IMPLEMENTATION.md`** - Multi-workspace system overview (ESSENTIAL)
**4. Read `PR_SUMMARY.md`** - Technical implementation details (FOR CHANGES)

## 🚨 CRITICAL: ALWAYS CREATE A PR WHEN DONE 🚨
**When you complete ANY feature or fix, you MUST create a pull request using `gh pr create`. This is NOT optional. Add "Create PR" as your final todo item to ensure you never forget.**

## Git Workflow Notes
- Always work on fresh branches from updated main
- If `git fetch origin main:main` fails, use `git fetch origin main && git checkout -b feature/name origin/main`

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
- **Tauri App**: Native desktop application (`src-tauri/`)
- **Diff Viewer**: Advanced code review tool (`diff-viewer/`)

## Commander Claude (Top-Level AI)

Commander Claude is a special Claude Code instance that runs from the orchestrator directory with knowledge of the entire system. When you ARE Commander Claude (running in this directory), you have these capabilities:

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

# View all sessions
GET /api/commander/sessions

# Send to another session
POST /api/commander/send-to-session  { sessionId: "...", input: "..." }
```

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

# Testing
node --check server/index.js

# Workspace migration (if needed)
node scripts/migrate-to-workspaces.js
```

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
- Both instances can run simultaneously without conflicts
- The `.env` files control which ports are used
- `npm start`, `npm run dev`, and `npm run prod` are all equivalent
- Each instance needs its own `node_modules` and `diff-viewer/node_modules`

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨
