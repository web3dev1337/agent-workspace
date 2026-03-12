# Claude Orchestrator: Workspace Management System Analysis

## Executive Summary

This document analyzes requirements for transforming Claude Orchestrator from a single-project tool into a multi-workspace development environment with one-click access, custom configurations per project, and zero-friction workflows.

## Current State Analysis

### What Works Well
- **Solid Foundation**: Service-oriented architecture with SessionManager, StatusDetector, GitHelper
- **Real-time Communication**: Socket.IO for live updates works reliably
- **Terminal Management**: PTY-based sessions with good lifecycle management
- **Native App**: Tauri provides 10-20x faster startup than browser
- **Diff Viewer**: Advanced code review component already integrated

### Current Limitations
1. **Single Project Focus**: Hardcoded to one project (HyFire) with 8 worktrees
2. **High Startup Friction**: Multiple manual steps to launch (cd, commands, opening browser)
3. **Fixed Terminal Layout**: Hardcoded 8 Claude + 8 server pairs
4. **No Workspace Switching**: Can't easily swap between different projects
5. **Limited Customization**: Buttons/features not project-specific
6. **Configuration Complexity**: Editing config files manually for flags/settings
7. **No Quick Access**: No shortcuts to external tools (Sentry, dashboards, etc.)
8. **Single Model**: No easy way to swap AI models or configurations

## Requirements Analysis

### 1. Workspace Management System (CORE)

#### 1.1 Workspace Definition
A "workspace" is a complete development environment for a specific project, containing:
- **Terminal Configuration**: Number and type of terminal pairs (Claude + server)
- **Repository Links**: Path to project folder, worktree configuration
- **Custom Buttons**: Project-specific actions (play, server, replay, build, etc.)
- **Launch Settings**: Environment flags, model selection, startup commands
- **External Links**: Quick access to Sentry, dashboards, documentation, etc.
- **Layout Preferences**: Terminal arrangement, theme, display options

#### 1.2 Workspace Types
- **Project Workspaces**: Full configuration for specific projects
  - HyFire (8 worktrees, game server buttons, replay functionality)
  - Epic Survivors (likely similar to HyFire)
  - Carm Crypto (web-focused, different button set)
  - Book Project (minimal servers, writing-focused tools)

- **Workspace Templates**: Base configurations for common project types
  - `template-game`: Game development (server controls, build buttons, replay)
  - `template-web`: Web app (frontend/backend, deploy buttons)
  - `template-simple`: Single-terminal projects (scripts, writing, docs)

- **Custom Workspaces**: Mix-and-match from multiple projects
  - Example: 6 terminals from Epic Survivors for focused work
  - Example: 2 from HyFire + 2 from website for cross-project work

#### 1.3 Workspace Switching
User needs to easily:
- **See all workspaces**: Dropdown or sidebar showing available workspaces
- **Quick switch**: One-click to change active workspace
- **Preserve state**: Each workspace remembers its terminal states, branches, etc.
- **Fast loading**: Switch should be near-instant (leverage Tauri speed)

### 2. Flexible Terminal Configuration

#### Current System
```json
{
  "worktrees": {
    "basePath": "auto",
    "count": 8  // Hardcoded!
  }
}
```

#### Required System
```javascript
{
  "workspaces": {
    "hyfire": {
      "terminals": [
        { "type": "claude", "repo": "~/GitHub/games/hytopia", "worktree": 1 },
        { "type": "server", "repo": "~/GitHub/games/hytopia", "worktree": 1 },
        // ... up to 8 pairs for HyFire
      ]
    },
    "epic-survivors": {
      "terminals": [
        // Could be 6 pairs, 10 pairs, whatever needed
      ]
    },
    "book": {
      "terminals": [
        { "type": "claude", "repo": "~/writing/book", "worktree": null },
        { "type": "server", "repo": "~/writing/book", "worktree": null }
      ]
    }
  }
}
```

### 3. Custom Buttons & Actions Per Workspace

#### Shared Core Buttons (All Workspaces)
- Refresh
- Pull Request
- Git Update
- Clear Terminal
- Restart Session

#### Project-Specific Button Examples

**HyFire Workspace:**
```javascript
buttons: [
  { id: "play-dev", label: "▶ Play Dev", action: "launchGame", env: "dev" },
  { id: "play-prod", label: "▶ Play Prod", action: "launchGame", env: "prod" },
  { id: "server-start", label: "🚀 Server", action: "startServer", dropdown: ["dev", "prod", "5v5", "deathmatch"] },
  { id: "replay", label: "↻ Replay", action: "loadReplay" },
  { id: "build-prod", label: "📦 Build", action: "buildProduction" },
  { id: "perf-log", label: "📊 Perf Log", action: "runWithPerformance" }
]
```

**Epic Survivors Workspace:**
```javascript
buttons: [
  { id: "play-dev", label: "▶ Play Dev", action: "launchGame", env: "dev" },
  { id: "server-start", label: "🚀 Server", action: "startServer" },
  // No replay button - doesn't need it
  { id: "build-prod", label: "📦 Build", action: "buildProduction" }
]
```

**Website/Carm Crypto Workspace:**
```javascript
buttons: [
  { id: "dev-server", label: "🌐 Dev Server", action: "startDevServer" },
  { id: "build", label: "📦 Build", action: "build" },
  { id: "deploy", label: "🚀 Deploy", action: "deploy", dropdown: ["staging", "production"] },
  { id: "test", label: "🧪 Test", action: "runTests" }
]
```

**Book Workspace:**
```javascript
buttons: [
  { id: "preview", label: "👁 Preview", action: "previewMarkdown" },
  { id: "export-pdf", label: "📄 Export PDF", action: "exportPDF" },
  { id: "word-count", label: "📊 Stats", action: "showStats" }
]
```

### 4. Launch Settings & Feature Flags

#### Current Pain Points
- Manual editing of config files for different game modes
- Hard to remember which flags do what
- No UI for common variations (performance logging, 5v5 mode, deathmatch, etc.)

#### Proposed Solution: Launch Profiles
```javascript
{
  "hyfire": {
    "launchProfiles": {
      "default": {
        "nodeOptions": "",
        "envVars": "NODE_ENV=development",
        "gameArgs": ""
      },
      "performance": {
        "nodeOptions": "--inspect --prof",
        "envVars": "NODE_ENV=development ENABLE_PROFILING=true",
        "gameArgs": ""
      },
      "5v5": {
        "nodeOptions": "",
        "envVars": "NODE_ENV=development",
        "gameArgs": "--mode=5v5"
      },
      "deathmatch": {
        "nodeOptions": "",
        "envVars": "NODE_ENV=development",
        "gameArgs": "--mode=deathmatch"
      },
      "new-map-test": {
        "nodeOptions": "",
        "envVars": "NODE_ENV=development MAP_OVERRIDE=test-map",
        "gameArgs": ""
      }
    }
  }
}
```

UI would show dropdown: "Launch with: [Default ▼]" → Select "Performance" → Starts with profiling enabled

### 5. One-Click Startup System

#### Current Workflow (Too Much Friction!)
1. Open HyFire project in VSCode
2. Ctrl+Shift+P → Start worktrees (maybe?)
3. Open new terminal
4. `cd ..`
5. `cd claude-orchestrator-temp`
6. Ctrl+R, search for "dev"
7. Run `npm run dev:all`
8. Wait for startup
9. Open browser, type in URL
10. Navigate to orchestrator page

#### Proposed Workflow (Zero Friction!)
1. Click desktop shortcut "🎮 Claude Orchestrator"
2. *Everything loads automatically*

#### Implementation: Startup Script
```bash
#!/bin/bash
# ~/.local/bin/orchestrator (or ~/Desktop/orchestrator.sh)

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Claude Orchestrator...${NC}"

# 1. Navigate to orchestrator directory
cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev

# 2. Pull latest changes by default (add a flag to skip if needed)
if [ "$1" == "--update" ] || [ -z "$1" ]; then
  echo -e "${BLUE}📥 Pulling latest changes...${NC}"
  git pull origin main
fi

# 3. Check if already running (avoid duplicate instances)
if lsof -i:9460 > /dev/null; then
  echo -e "${GREEN}✅ Orchestrator already running!${NC}"

  # Just open browser to existing instance
  if command -v xdg-open > /dev/null; then
    xdg-open http://localhost:9461
  elif command -v open > /dev/null; then
    open http://localhost:9461
  fi

  exit 0
fi

# 4. Start orchestrator services
echo -e "${BLUE}🔧 Starting services...${NC}"
npm run prod &

# 5. Wait for services to be ready
echo -e "${BLUE}⏳ Waiting for services...${NC}"
while ! lsof -i:9461 > /dev/null; do
  sleep 0.5
done

# 6. Open browser automatically
echo -e "${GREEN}✅ Opening orchestrator...${NC}"
sleep 1
if command -v xdg-open > /dev/null; then
  xdg-open http://localhost:9461
elif command -v open > /dev/null; then
  open http://localhost:9461
fi

echo -e "${GREEN}🎉 Claude Orchestrator ready!${NC}"
```

Make executable and create desktop shortcut:
```bash
chmod +x ~/.local/bin/orchestrator
# Then create desktop shortcut pointing to this script
```

### 6. Quick Access Links & External Tools

Add a "Quick Links" section in sidebar:

```javascript
{
  "hyfire": {
    "quickLinks": [
      {
        "category": "Monitoring",
        "links": [
          { "label": "Sentry Dashboard", "url": "https://sentry.io/organizations/your-org/issues/" },
          { "label": "Sentry Performance", "url": "https://sentry.io/organizations/your-org/performance/" },
          { "label": "Error Logs", "url": "https://sentry.io/organizations/your-org/issues/?query=is:unresolved" }
        ]
      },
      {
        "category": "Documentation",
        "links": [
          { "label": "Hytopia Docs", "url": "https://docs.hytopia.com" },
          { "label": "API Reference", "url": "https://docs.hytopia.com/api" }
        ]
      },
      {
        "category": "Tools",
        "links": [
          { "label": "Config Loader", "action": "openConfigLoader" },
          { "label": "Performance Analyzer", "action": "openPerfAnalyzer" }
        ]
      }
    ]
  }
}
```

### 7. AI Model Selection

#### Current State
- Claude Code hardcoded (configured globally on machine)
- Model specified in Claude Code config, not orchestrator

#### Proposed Integration
While we can't directly control Claude Code's model selection (that's in their config), we can:

1. **Quick Model Switcher UI**: Buttons to swap between common setups
   - "Opus (Max)" - Uses API with Opus
   - "Sonnet (Fast)" - Uses API with Sonnet
   - "Haiku (Testing)" - Uses API with Haiku

2. **Behind the scenes**: These would:
   - Modify `~/.config/claude/config.json` (or equivalent)
   - Restart Claude sessions with new model
   - Track which model each session is using

3. **Per-Terminal Model**: Future feature - different terminals could use different models
   - "Main work" terminals use Opus
   - "Testing/quick tasks" use Sonnet
   - "Code review" use Haiku

4. **CLAUDE.md vs AGENTS.md handling**:
   - Workspace config specifies which instruction file to use
   - Orchestrator can create symlinks or set environment variables
   - Per-project agent instructions

### 8. Workspace Creation Wizard

Instead of manually editing JSON configs, provide a UI wizard:

```
┌─────────────────────────────────────────┐
│  Create New Workspace                   │
├─────────────────────────────────────────┤
│                                         │
│  Workspace Name: [Epic Survivors    ]  │
│                                         │
│  Template: [Game Development    ▼]     │
│    • Game Development                   │
│    • Web Application                    │
│    • Simple Project                     │
│    • Custom (start from scratch)        │
│                                         │
│  Repository Path: [Browse...]           │
│  📁 ~/GitHub/games/epic-survivors       │
│                                         │
│  Worktrees:                             │
│    ☑ Use worktrees                      │
│    Number: [8]                          │
│                                         │
│  Terminal Pairs: [8]                    │
│    (Each pair = 1 Claude + 1 Server)    │
│                                         │
│  Custom Buttons:                        │
│    ☑ Play (Dev/Prod)                    │
│    ☑ Start Server                       │
│    ☐ Replay System                      │
│    ☑ Build Production                   │
│    ☑ Performance Logging                │
│                                         │
│       [Cancel]  [Create Workspace]      │
└─────────────────────────────────────────┘
```

This wizard:
- Scans `~/GitHub/` for repos
- Offers to create worktrees automatically
- Generates config JSON
- Optionally creates worktree directories
- Initializes workspace with starter buttons

## Architecture Design

### New Components Needed

#### 1. WorkspaceManager (New Core Service)
```javascript
class WorkspaceManager {
  constructor() {
    this.workspaces = new Map();
    this.activeWorkspace = null;
    this.workspaceConfigs = this.loadWorkspaceConfigs();
  }

  loadWorkspaceConfigs() {
    // Load from ~/.orchestrator/workspaces/*.json
  }

  switchWorkspace(workspaceId) {
    // 1. Save current workspace state
    // 2. Load new workspace config
    // 3. Reconfigure SessionManager
    // 4. Update UI
    // 5. Restore session states if they exist
  }

  createWorkspace(config) {
    // Wizard-driven workspace creation
  }

  getWorkspace(id) {
    return this.workspaces.get(id);
  }

  listWorkspaces() {
    return Array.from(this.workspaces.values());
  }
}
```

#### 2. ButtonActionRegistry (New)
```javascript
class ButtonActionRegistry {
  constructor() {
    this.actions = new Map();
    this.registerDefaultActions();
  }

  registerAction(id, handler) {
    this.actions.set(id, handler);
  }

  registerDefaultActions() {
    // Core actions all workspaces can use
    this.register('startServer', this.handleStartServer);
    this.register('launchGame', this.handleLaunchGame);
    this.register('buildProduction', this.handleBuildProduction);
    // etc.
  }

  executeAction(actionId, params) {
    const handler = this.actions.get(actionId);
    if (handler) {
      return handler(params);
    }
  }
}
```

#### 3. LaunchProfileManager (New)
```javascript
class LaunchProfileManager {
  constructor(workspace) {
    this.workspace = workspace;
    this.profiles = workspace.config.launchProfiles || {};
  }

  getProfile(profileId) {
    return this.profiles[profileId] || this.profiles.default;
  }

  buildLaunchCommand(sessionId, profileId, environment) {
    const profile = this.getProfile(profileId);
    // Build command string with node options, env vars, game args
    return this.formatCommand(profile, environment);
  }
}
```

#### 4. WorkspaceUI (New Frontend Component)
```javascript
class WorkspaceUI {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.currentWorkspace = null;
  }

  renderWorkspaceSwitcher() {
    // Dropdown in header
  }

  renderCustomButtons(workspace) {
    // Render workspace-specific buttons
  }

  renderQuickLinks(workspace) {
    // Render external links sidebar
  }

  switchWorkspace(workspaceId) {
    // Handle UI transition
  }
}
```

### Modified Components

#### SessionManager (Enhanced)
```javascript
class SessionManager {
  // ADD:
  setWorkspace(workspace) {
    this.workspace = workspace;
    this.reconfigureSessions();
  }

  reconfigureSessions() {
    // Adjust terminal count based on workspace config
    // Update repository paths
    // Apply workspace-specific settings
  }

  createSessionsForWorkspace(workspace) {
    // Create exactly the number and type of sessions
    // workspace specifies
  }
}
```

### Configuration Structure

#### Master Config
```javascript
// ~/.orchestrator/config.json
{
  "version": "2.0.0",
  "activeWorkspace": "hyfire",
  "workspaceDirectory": "~/.orchestrator/workspaces",
  "theme": "dark",
  "startupOptions": {
    "autoUpdate": true,
    "openBrowserOnStart": true,
    "restoreLastWorkspace": true
  }
}
```

#### Workspace Config
```javascript
// ~/.orchestrator/workspaces/hyfire.json
{
  "id": "hyfire",
  "name": "HyFire Game Development",
  "description": "Main HyFire project workspace with 8 worktrees",
  "template": "game-development",
  "repository": {
    "path": "~/GitHub/games/hytopia",
    "worktrees": {
      "enabled": true,
      "count": 8,
      "basePath": "~/GitHub/games/hytopia"
    }
  },
  "terminals": {
    "pairs": 8,
    "layout": "2x4",
    "defaultShell": "/bin/bash"
  },
  "buttons": [
    {
      "id": "play-dev",
      "label": "▶ Play Dev",
      "category": "game",
      "action": "launchGame",
      "params": { "environment": "dev" },
      "icon": "play",
      "color": "green"
    },
    {
      "id": "server-start",
      "label": "🚀 Server",
      "category": "server",
      "action": "startServer",
      "dropdown": [
        { "label": "Dev", "value": "dev" },
        { "label": "Prod", "value": "prod" },
        { "label": "5v5 Mode", "value": "5v5" },
        { "label": "Deathmatch", "value": "deathmatch" },
        { "label": "With Performance Logging", "value": "performance" }
      ]
    },
    {
      "id": "replay",
      "label": "↻ Replay",
      "category": "game",
      "action": "loadReplay",
      "icon": "replay"
    }
  ],
  "launchProfiles": {
    "default": {
      "nodeOptions": "",
      "envVars": "NODE_ENV=development",
      "gameArgs": ""
    },
    "performance": {
      "nodeOptions": "--inspect --prof",
      "envVars": "NODE_ENV=development ENABLE_PROFILING=true",
      "gameArgs": ""
    },
    "5v5": {
      "nodeOptions": "",
      "envVars": "NODE_ENV=development",
      "gameArgs": "--mode=5v5"
    },
    "deathmatch": {
      "nodeOptions": "",
      "envVars": "NODE_ENV=development",
      "gameArgs": "--mode=deathmatch"
    }
  },
  "quickLinks": [
    {
      "category": "Monitoring",
      "links": [
        { "label": "Sentry Dashboard", "url": "https://sentry.io/..." },
        { "label": "Sentry Errors", "url": "https://sentry.io/..." }
      ]
    },
    {
      "category": "Tools",
      "links": [
        { "label": "Performance Analyzer", "action": "openPerfAnalyzer" }
      ]
    }
  ],
  "theme": {
    "primaryColor": "#ff6b35",
    "icon": "🎮"
  }
}
```

#### Template Config
```javascript
// ~/.orchestrator/templates/game-development.json
{
  "id": "game-development",
  "name": "Game Development Template",
  "description": "Template for game projects with server controls",
  "defaultButtons": [
    {
      "id": "play-dev",
      "label": "▶ Play Dev",
      "action": "launchGame",
      "params": { "environment": "dev" }
    },
    {
      "id": "server-start",
      "label": "🚀 Server",
      "action": "startServer"
    },
    {
      "id": "build-prod",
      "label": "📦 Build",
      "action": "buildProduction"
    }
  ],
  "terminals": {
    "pairs": 8,
    "layout": "2x4"
  }
}
```

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal**: Core workspace management without UI

#### Tasks:
1. Create `WorkspaceManager` service
2. Define workspace JSON schema
3. Implement workspace loading/saving
4. Add workspace switching logic to SessionManager
5. Create config migration tool (old config → workspace config)
6. Write tests for workspace management

**Deliverable**: Backend can load multiple workspace configs and switch between them programmatically

### Phase 2: UI & Workspace Switching (Week 2-3)
**Goal**: User can switch workspaces via UI

#### Tasks:
1. Add workspace switcher dropdown to header
2. Implement smooth workspace transitions
3. Save/restore session states per workspace
4. Add workspace indicator (name, icon) to UI
5. Handle terminal reconfiguration on switch
6. Test workspace persistence across restarts

**Deliverable**: Users can switch between 2-3 pre-configured workspaces

### Phase 3: Custom Buttons & Actions (Week 3-4)
**Goal**: Workspaces have different buttons

#### Tasks:
1. Create `ButtonActionRegistry`
2. Implement dynamic button rendering
3. Add dropdown support for buttons
4. Create action handlers for common operations
5. Add button customization UI
6. Test with HyFire, Epic Survivors, and book workspaces

**Deliverable**: Each workspace shows its own custom button set

### Phase 4: Launch Profiles (Week 4-5)
**Goal**: Easy flag/settings management

#### Tasks:
1. Create `LaunchProfileManager`
2. Add launch profile dropdown to server start buttons
3. Implement command building from profiles
4. Add UI for editing launch profiles
5. Create common profiles (default, performance, test modes)
6. Test with various game modes and settings

**Deliverable**: Users can launch servers with different flags via dropdown

### Phase 5: Workspace Creation Wizard (Week 5-6)
**Goal**: Users can create workspaces without editing JSON

#### Tasks:
1. Design wizard UI flow
2. Implement repo scanning/selection
3. Add template selection
4. Create worktree initialization helper
5. Build workspace config generator
6. Add workspace templates (game, web, simple)

**Deliverable**: Users can create new workspaces via wizard

### Phase 6: One-Click Startup (Week 6)
**Goal**: Zero-friction launch

#### Tasks:
1. Write startup script (bash)
2. Add auto-update option
3. Create desktop shortcut generator
4. Add "already running" detection
5. Implement auto-browser-opening
6. Test on fresh system install

**Deliverable**: Single click/command launches entire orchestrator

### Phase 7: Quick Links & External Tools (Week 7)
**Goal**: Quick access to external resources

#### Tasks:
1. Add "Quick Links" sidebar section
2. Implement link categories
3. Add action links (trigger orchestrator actions)
4. Create link editor UI
5. Add icon/emoji support for links
6. Test with Sentry, docs, and tool links

**Deliverable**: Sidebar shows workspace-specific quick links

### Phase 8: Polish & Advanced Features (Week 8+)

#### Tasks:
1. **Workspace templates**: More templates (web, API, data science, etc.)
2. **Model selection**: UI for swapping Claude models (if feasible)
3. **Custom workspace mixing**: Combine terminals from multiple projects
4. **Workspace export/import**: Share workspace configs
5. **Performance optimization**: Fast workspace switching
6. **Documentation**: User guide, video tutorials
7. **Backup/restore**: Workspace config backups

## Additional Features & Ideas

### 1. Workspace Groups
Group related workspaces:
- "Games" → HyFire, Epic Survivors, etc.
- "Web Projects" → Carm Crypto, personal website
- "Writing" → Book, blog, articles

### 2. Session Templates
Pre-configured terminal commands:
- "HyFire Server" → automatically runs `hytopia start` on launch
- "Claude (No Sandbox)" → starts with `--dangerously-skip-permissions`

### 3. Workspace Activity Timeline
Track when you last worked on each workspace:
- "HyFire: Last active 2 hours ago"
- "Book: Last active 3 days ago"

### 4. Collaborative Workspaces
Share workspace configs with team:
- Export `.orchestrator-workspace` file
- Team members import and get same setup
- Useful for onboarding new developers

### 5. Environment Sync
Automatically sync certain settings:
- Git branch tracking across terminals
- Active PR status
- Last build status
- Server running/stopped states

### 6. Smart Workspace Recommendations
Orchestrator suggests workspace based on context:
- Detect current git repo → "Switch to HyFire workspace?"
- Time of day patterns → "Usually work on Book at this time"

### 7. Workspace Hotkeys
Keyboard shortcuts for quick switching:
- `Ctrl+Shift+1` → HyFire
- `Ctrl+Shift+2` → Epic Survivors
- `Ctrl+Shift+W` → Workspace switcher

### 8. Performance Monitoring Dashboard
Built-in tools for HyFire performance analysis:
- Parse performance logs
- Show FPS graphs, memory usage
- Compare performance across builds

### 9. Integrated Sentry Panel
Embed Sentry dashboard directly:
- Show error count badge on workspace icon
- Quick error viewer without leaving orchestrator
- Error → code jump (click error, opens relevant file)

### 10. Claude Code Integration Enhancements
- **Token usage display**: Show per-session token consumption
- **Session checkpoints**: Save Claude context states
- **Multi-model sessions**: Different terminals use different models
- **Agent instruction swapping**: Quick CLAUDE.md vs AGENTS.md toggle

## Technical Considerations

### Data Storage
```
~/.orchestrator/
├── config.json                    # Master config
├── workspaces/                    # Workspace configs
│   ├── hyfire.json
│   ├── epic-survivors.json
│   ├── book.json
│   └── carm-crypto.json
├── templates/                     # Workspace templates
│   ├── game-development.json
│   ├── web-application.json
│   └── simple-project.json
├── session-states/                # Persistent session states
│   ├── hyfire/
│   │   ├── work1-claude.state
│   │   └── work1-server.state
│   └── epic-survivors/
│       └── ...
└── logs/
    └── orchestrator.log
```

### Performance Targets
- **Workspace switch**: < 500ms
- **Startup (cold)**: < 3 seconds
- **Startup (warm)**: < 1 second
- **Terminal creation**: < 200ms per terminal
- **Config reload**: < 100ms

### Backward Compatibility
- Old config.json automatically migrated to workspace format
- Default "legacy" workspace created from current setup
- Users can continue with single workspace initially

### Security Considerations
- Workspace configs can contain paths, but never secrets
- Launch profiles may contain env vars, but warn on sensitive data
- External links vetted (no javascript: URLs, etc.)
- Script execution requires confirmation for new workspaces

## Success Metrics

### User Experience
- **Startup time reduced from 2 minutes to 10 seconds**
- **Context switching reduced from 30s to 5s** (workspace switch)
- **Zero manual config editing needed** (wizard handles it)
- **50% reduction in "friction delays"** (avoiding orchestrator due to startup hassle)

### Functionality
- **Support 10+ distinct workspaces** without performance degradation
- **100% feature parity per workspace** (each can be fully customized)
- **Quick links reduce external tool access time by 80%** (no more hunting for Sentry URL)

### Development Velocity
- **20% faster feature development** (less time fighting tools)
- **Fewer context switches** (all tools in one place)
- **Better focus** (workspace-specific UI removes distractions)

## Next Steps

1. **User Validation**: Review this document with you to confirm requirements
2. **Prioritization**: Identify which phases are most critical
3. **Phase 1 Kickoff**: Begin implementing WorkspaceManager
4. **Iterative Development**: Build one phase, get feedback, iterate
5. **Documentation**: Create user guide as features are built

## Questions for User

1. **Workspace Scope**: Should workspaces be able to include terminals from multiple repos? (e.g., HyFire + related tools repo)
2. **Worktree Management**: Should orchestrator handle worktree creation, or just use existing ones?
3. **Model Selection**: How important is swapping Claude models? Is this a Phase 1 feature or later?
4. **Migration**: Should we auto-migrate your current setup to a "HyFire" workspace, or start fresh?
5. **Templates**: What other project types besides game/web/simple would be useful?
6. **Cloud Sync**: Interest in syncing workspace configs across machines (Dropbox, git, etc.)?

---

**Document Version**: 1.0
**Date**: 2025-09-27
**Status**: Draft for Review
