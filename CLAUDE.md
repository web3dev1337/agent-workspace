# Claude Orchestrator Guidelines for Claude Code

🚨 **READ THIS ENTIRE FILE** 🚨
**CRITICAL: You MUST read this complete file from start to finish. Do not truncate or skip sections.**

*Note: This is a multi-terminal orchestrator project for managing Claude Code sessions with native desktop app and advanced diff viewer capabilities.*

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

## 🚨 CRITICAL: ALWAYS CREATE A PR WHEN DONE 🚨
**When you complete ANY feature or fix, you MUST create a pull request using `gh pr create`. This is NOT optional. Add "Create PR" as your final todo item to ensure you never forget.**

## Git Workflow Notes
- Always work on fresh branches from updated main
- If `git fetch origin main:main` fails, use `git fetch origin main && git checkout -b feature/name origin/main`

## Code Style Guidelines

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
- **NotificationService**: System notifications (`server/notificationService.js`)
- **Tauri App**: Native desktop application (`src-tauri/`)
- **Diff Viewer**: Advanced code review tool (`diff-viewer/`)

### Important Files to Read First
- `CODEBASE_DOCUMENTATION.md`: Comprehensive system overview
- `server/index.js`: Main backend entry point
- `package.json`: Dependencies and scripts
- `src-tauri/src/main.rs`: Tauri app entry point

### Project Components
- **Multi-Terminal Management**: 16 terminal grid (8 Claude + 8 server terminals)
- **Native Desktop App**: High-performance Tauri-based application
- **Advanced Diff Viewer**: Web-based code review with AI analysis
- **Real-time Communication**: Socket.IO for live updates

## Common Commands
```bash
# Development
npm run dev
npm run tauri:dev

# Testing
node --check server/index.js
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

## Development Setup - Two Isolated Instances

### Why Two Instances?
To avoid conflicts when developing the Orchestrator itself while using it for other work.

### 🎯 SIMPLE COMMANDS:

#### Production Instance (Your Daily Work):
```bash
cd ~/claude-orchestrator
npm run prod           # Runs on ports 3000/2080
```

#### Development Instance (Modifying the Orchestrator):
```bash
cd ~/claude-orchestrator-dev
npm run dev   # Runs on ports 4000/2081 (override ports)
# OR just use: npm run dev:all (since .env already sets ports to 4000/2081)
```

### Setup Details:

Both directories are already configured with different `.env` files:

**~/claude-orchestrator/.env** (Production)
- PORT=3000
- Default client port 2080
- For your actual Claude sessions

**~/claude-orchestrator-dev/.env** (Development)
- PORT=4000
- CLIENT_PORT=2081
- TAURI_DEV_PORT=1421
- For developing/testing the Orchestrator

### Quick Reference:

| Purpose | Directory | Command | Ports | Use Case |
|---------|-----------|---------|-------|----------|
| **Production** | ~/claude-orchestrator | `npm run prod` | 3000/2080/7655 | Your daily Claude work |
| **Development** | ~/claude-orchestrator-dev | `npm run dev` or `dev:all` | 4000/2081/7656 | Modifying Orchestrator |

### What Gets Started:
All commands (`prod`, `dev:all`, `dev`) run these 4 services:
- **Server** (Express backend with hot-reload)
- **Client** (Web UI dev server)
- **Tauri** (Native desktop app)
- **Diff Viewer** (PR review tool on port 7655 for prod, 7656 for dev)

### Important Notes:
- Both instances can run simultaneously without conflicts
- The `.env` files control which ports are used (no need to override)
- `dev` command explicitly sets ports to 4000/2081 (redundant in dev folder since .env has them)
- In `claude-orchestrator-dev`, you can just use `npm run dev:all` since .env already has the right ports

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨