# Workspace Management Implementation Plan

## Quick Start Summary

This plan transforms Claude Orchestrator from a single-project tool into a multi-workspace development environment. Core changes:

1. **Workspace System**: Switch between project-specific configurations (HyFire, Epic Survivors, Book, etc.)
2. **Flexible Terminals**: Variable terminal count per workspace (not hardcoded to 8)
3. **Custom Buttons**: Each workspace has its own action buttons (play, server, replay, etc.)
4. **Launch Profiles**: Dropdown for different server modes (dev, prod, performance, 5v5, deathmatch)
5. **One-Click Startup**: Bash script to launch everything instantly
6. **Quick Links**: Sidebar with shortcuts to Sentry, docs, tools
7. **Zero Friction**: Remove all startup barriers, make development instant

## Phase-by-Phase Implementation

### 🎯 Phase 1: Foundation (Week 1-2)
**Goal**: Core workspace management backend

**Files to Create**:
- `server/workspaceManager.js` - Main workspace management service
- `server/schemas/workspace-schema.json` - Workspace config schema
- `server/schemas/template-schema.json` - Template config schema
- `config/migrate-to-workspaces.js` - Migration tool for existing config

**Files to Modify**:
- `server/sessionManager.js` - Add workspace support
- `server/index.js` - Integrate WorkspaceManager
- `config.json` → `~/.orchestrator/config.json` (new location)

**Key Code**:
```javascript
// server/workspaceManager.js
class WorkspaceManager {
  constructor() {
    this.workspaces = new Map();
    this.activeWorkspace = null;
    this.configPath = path.join(os.homedir(), '.orchestrator');
  }

  async loadWorkspaces() {
    const workspacePath = path.join(this.configPath, 'workspaces');
    const files = fs.readdirSync(workspacePath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const config = JSON.parse(fs.readFileSync(path.join(workspacePath, file)));
        this.workspaces.set(config.id, config);
      }
    }
  }

  async switchWorkspace(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    this.activeWorkspace = workspace;
    this.emit('workspace-changed', workspace);
    return workspace;
  }

  getActiveWorkspace() {
    return this.activeWorkspace;
  }
}
```

**Testing**:
- Load workspace configs from disk
- Switch between 2 workspaces
- Verify session count changes based on workspace
- Test config migration from old format

**Success Criteria**:
- ✅ Backend can load multiple workspace configs
- ✅ Can switch between workspaces programmatically
- ✅ SessionManager respects workspace terminal count
- ✅ Old config migrates to new format automatically

---

### 🎨 Phase 2: UI & Workspace Switching (Week 2-3)
**Goal**: User can switch workspaces via UI

**Files to Create**:
- `client/workspace-ui.js` - Workspace UI component
- `client/workspace-switcher.js` - Dropdown switcher component

**Files to Modify**:
- `client/app.js` - Add workspace switcher to header
- `client/index.html` - Add workspace switcher UI elements
- `client/styles.css` - Style workspace switcher

**Key Code**:
```javascript
// client/workspace-switcher.js
class WorkspaceSwitcher {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.render();
  }

  render() {
    const header = document.querySelector('.header');
    const switcher = document.createElement('div');
    switcher.className = 'workspace-switcher';
    switcher.innerHTML = `
      <select id="workspace-select">
        ${this.orchestrator.workspaces.map(w =>
          `<option value="${w.id}" ${w.id === this.orchestrator.currentWorkspace.id ? 'selected' : ''}>
            ${w.icon} ${w.name}
          </option>`
        ).join('')}
      </select>
    `;
    header.appendChild(switcher);

    document.getElementById('workspace-select').addEventListener('change', (e) => {
      this.switchWorkspace(e.target.value);
    });
  }

  async switchWorkspace(workspaceId) {
    // Show loading state
    this.showLoading();

    // Request workspace switch from server
    this.orchestrator.socket.emit('switch-workspace', { workspaceId });

    // Wait for workspace-changed event
    this.orchestrator.socket.once('workspace-changed', (workspace) => {
      this.orchestrator.currentWorkspace = workspace;
      this.rebuildUI();
      this.hideLoading();
    });
  }

  rebuildUI() {
    // Rebuild terminal grid based on new workspace
    this.orchestrator.buildTerminalGrid();
    this.orchestrator.buildSidebar();
    this.renderCustomButtons();
  }
}
```

**Testing**:
- Switch between HyFire and Book workspaces
- Verify terminal count changes (8 pairs → 1 pair)
- Verify UI updates (different buttons appear)
- Test session state preservation
- Test switching back and forth rapidly

**Success Criteria**:
- ✅ Dropdown shows all available workspaces
- ✅ Switching updates terminal grid
- ✅ Session states preserved when switching back
- ✅ No memory leaks or orphaned sessions
- ✅ UI updates smoothly (< 500ms)

---

### 🔘 Phase 3: Custom Buttons & Actions (Week 3-4)
**Goal**: Each workspace has its own buttons

**Files to Create**:
- `server/buttonActionRegistry.js` - Action handler registry
- `client/button-renderer.js` - Dynamic button rendering

**Files to Modify**:
- `client/app.js` - Use dynamic button renderer
- `server/index.js` - Add action execution endpoints

**Key Code**:
```javascript
// server/buttonActionRegistry.js
class ButtonActionRegistry {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.actions = new Map();
    this.registerDefaultActions();
  }

  registerDefaultActions() {
    this.register('startServer', async ({ sessionId, environment, profile }) => {
      const workspace = this.sessionManager.getWorkspace();
      const launchProfile = workspace.launchProfiles[profile] || workspace.launchProfiles.default;

      const command = this.buildCommand(launchProfile, environment);
      this.sessionManager.writeToSession(sessionId, command);
    });

    this.register('launchGame', async ({ sessionId, environment }) => {
      // Game launch logic
    });

    this.register('buildProduction', async ({ sessionId }) => {
      // Build logic
    });

    this.register('loadReplay', async ({ sessionId }) => {
      // Replay logic (HyFire specific)
    });
  }

  register(actionId, handler) {
    this.actions.set(actionId, handler);
  }

  async execute(actionId, params) {
    const handler = this.actions.get(actionId);
    if (!handler) throw new Error(`Action ${actionId} not found`);
    return await handler(params);
  }

  buildCommand(profile, environment) {
    const parts = [];
    if (profile.envVars) parts.push(profile.envVars);
    if (profile.nodeOptions) parts.push(`node ${profile.nodeOptions}`);
    parts.push('hytopia start');
    if (profile.gameArgs) parts.push(profile.gameArgs);
    return parts.join(' ') + '\n';
  }
}
```

```javascript
// client/button-renderer.js
class ButtonRenderer {
  constructor(workspace) {
    this.workspace = workspace;
  }

  renderButtons(container) {
    const buttons = this.workspace.buttons || [];
    container.innerHTML = '';

    for (const btn of buttons) {
      const btnElement = this.createButton(btn);
      container.appendChild(btnElement);
    }
  }

  createButton(config) {
    const btn = document.createElement('button');
    btn.className = `action-btn ${config.category || ''}`;
    btn.innerHTML = config.label;
    btn.dataset.action = config.action;
    btn.dataset.params = JSON.stringify(config.params || {});

    if (config.dropdown) {
      // Create dropdown menu
      const dropdown = this.createDropdown(config.dropdown);
      btn.appendChild(dropdown);
      btn.classList.add('has-dropdown');
    } else {
      btn.addEventListener('click', () => this.handleButtonClick(config));
    }

    return btn;
  }

  createDropdown(options) {
    const dropdown = document.createElement('select');
    dropdown.className = 'button-dropdown';
    dropdown.innerHTML = options.map(opt =>
      `<option value="${opt.value}">${opt.label}</option>`
    ).join('');
    return dropdown;
  }

  handleButtonClick(config) {
    const sessionId = this.getActiveSessionId();
    this.socket.emit('execute-action', {
      actionId: config.action,
      params: { sessionId, ...config.params }
    });
  }
}
```

**Testing**:
- HyFire workspace shows: Play, Server (dropdown), Replay, Build
- Book workspace shows: Preview, Export PDF, Stats
- Button clicks trigger correct actions
- Dropdowns work (server modes: dev/prod/5v5/deathmatch)
- Visual styling matches workspace theme

**Success Criteria**:
- ✅ Buttons render dynamically from workspace config
- ✅ Each workspace has unique button set
- ✅ Button actions execute correctly
- ✅ Dropdowns provide multiple options
- ✅ UI is intuitive and responsive

---

### ⚙️ Phase 4: Launch Profiles (Week 4-5)
**Goal**: Easy configuration for different launch modes

**Files to Create**:
- `server/launchProfileManager.js` - Launch profile handling

**Files to Modify**:
- `server/buttonActionRegistry.js` - Use launch profiles
- `client/button-renderer.js` - Show profile dropdown on server button

**Key Code**:
```javascript
// server/launchProfileManager.js
class LaunchProfileManager {
  constructor(workspace) {
    this.workspace = workspace;
    this.profiles = workspace.launchProfiles || {};
  }

  getProfile(profileId) {
    return this.profiles[profileId] || this.profiles.default;
  }

  buildLaunchCommand(sessionId, profileId, environment) {
    const profile = this.getProfile(profileId);
    const worktreeNum = this.extractWorktreeNum(sessionId);
    const port = 8080 + worktreeNum - 1;

    const parts = [];

    // Environment variables
    const envVars = profile.envVars || '';
    const nodeEnv = environment === 'production' ? 'production' : 'development';
    parts.push(`NODE_ENV=${nodeEnv} PORT=${port} ${envVars}`);

    // Node options (for profiling, debugging)
    if (profile.nodeOptions) {
      parts.push(`node ${profile.nodeOptions} $(which hytopia) start`);
    } else {
      parts.push('hytopia start');
    }

    // Game-specific arguments
    if (profile.gameArgs) {
      parts.push(profile.gameArgs);
    }

    return parts.join(' ') + '\n';
  }

  extractWorktreeNum(sessionId) {
    const match = sessionId.match(/work(\d+)/);
    return match ? parseInt(match[1]) : 1;
  }

  listProfiles() {
    return Object.keys(this.profiles);
  }
}
```

**Sample Workspace Config**:
```json
{
  "launchProfiles": {
    "default": {
      "nodeOptions": "",
      "envVars": "",
      "gameArgs": ""
    },
    "performance": {
      "nodeOptions": "--inspect --prof",
      "envVars": "ENABLE_PROFILING=true",
      "gameArgs": ""
    },
    "5v5": {
      "nodeOptions": "",
      "envVars": "",
      "gameArgs": "--mode=5v5"
    },
    "deathmatch": {
      "nodeOptions": "",
      "envVars": "",
      "gameArgs": "--mode=deathmatch --respawn-delay=3"
    }
  }
}
```

**Testing**:
- Launch server with "default" profile → normal startup
- Launch with "performance" profile → profiling enabled
- Launch with "5v5" profile → game starts in 5v5 mode
- Launch with "deathmatch" profile → deathmatch mode active
- Verify flags are applied correctly via terminal output

**Success Criteria**:
- ✅ Profile dropdown shows all available profiles
- ✅ Selected profile applies correct flags
- ✅ Performance profiling works when selected
- ✅ Game modes activate correctly
- ✅ Can add new profiles easily via JSON

---

### 🚀 Phase 5: Workspace Creation Wizard (Week 5-6)
**Goal**: Create workspaces via UI, no JSON editing

**Files to Create**:
- `client/workspace-wizard.js` - Multi-step wizard component
- `client/repo-scanner.js` - Scan for git repos
- `server/workspaceCreator.js` - Backend workspace creation logic

**Files to Modify**:
- `client/app.js` - Add "New Workspace" button
- `server/index.js` - Add workspace creation endpoint

**Key Features**:
1. **Step 1**: Name & Template
   - Workspace name input
   - Template selector (game, web, simple, custom)

2. **Step 2**: Repository Selection
   - Scan ~/GitHub/ for repos
   - Browse for custom path
   - Detect if worktrees are needed

3. **Step 3**: Terminal Configuration
   - Number of terminal pairs
   - Enable/disable worktrees
   - Worktree count

4. **Step 4**: Button Selection
   - Checkboxes for common buttons
   - Add custom buttons

5. **Step 5**: Quick Links
   - Add external URLs
   - Categorize links

6. **Step 6**: Review & Create
   - Show JSON preview
   - Confirm and create
   - Optional: Initialize worktrees automatically

**Testing**:
- Create "Epic Survivors" workspace using wizard
- Scan for repos, select epic-survivors repo
- Choose 6 terminal pairs, enable worktrees
- Select buttons: Play, Server, Build (no Replay)
- Add Sentry link
- Confirm creation → new workspace appears in switcher
- Switch to new workspace → everything works

**Success Criteria**:
- ✅ Wizard guides through all steps
- ✅ Repo scanning finds all GitHub repos
- ✅ Template selection pre-fills sensible defaults
- ✅ Created workspace config is valid
- ✅ New workspace immediately usable
- ✅ Optional worktree initialization works

---

### ⚡ Phase 6: One-Click Startup (Week 6)
**Goal**: Remove all startup friction

**Files to Create**:
- `scripts/orchestrator-startup.sh` - Main startup script
- `scripts/create-shortcut.sh` - Desktop shortcut generator
- `scripts/install.sh` - One-time setup script

**Startup Script** (`scripts/orchestrator-startup.sh`):
```bash
#!/bin/bash
# Claude Orchestrator Startup Script

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ORCHESTRATOR_DIR="$HOME/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev"
PORT=3000
CLIENT_PORT=2080

echo -e "${BLUE}🚀 Claude Orchestrator Startup${NC}"

# Check if already running
if lsof -i:$CLIENT_PORT >/dev/null 2>&1; then
  echo -e "${GREEN}✅ Orchestrator already running${NC}"

  # Just open browser
  if command -v xdg-open >/dev/null; then
    xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &
  elif command -v open >/dev/null; then
    open "http://localhost:$CLIENT_PORT"
  fi

  exit 0
fi

# Navigate to orchestrator
cd "$ORCHESTRATOR_DIR" || {
  echo -e "${YELLOW}❌ Orchestrator directory not found: $ORCHESTRATOR_DIR${NC}"
  exit 1
}

# Optional: Update to latest (can be disabled with --no-update flag)
if [[ "$1" != "--no-update" ]]; then
  echo -e "${BLUE}📥 Pulling latest changes...${NC}"
  git pull origin main 2>/dev/null || echo -e "${YELLOW}⚠ Could not pull latest (offline?)${NC}"
fi

# Start services in background
echo -e "${BLUE}🔧 Starting services...${NC}"
npm run prod >/dev/null 2>&1 &
ORCH_PID=$!

# Wait for services to be ready (check client port)
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
TIMEOUT=30
ELAPSED=0
while ! lsof -i:$CLIENT_PORT >/dev/null 2>&1; do
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))

  if [ $ELAPSED -gt $TIMEOUT ]; then
    echo -e "${YELLOW}❌ Timeout waiting for services${NC}"
    kill $ORCH_PID 2>/dev/null
    exit 1
  fi
done

# Open browser automatically
echo -e "${GREEN}✅ Opening orchestrator...${NC}"
sleep 1

if command -v xdg-open >/dev/null; then
  xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &
elif command -v open >/dev/null; then
  open "http://localhost:$CLIENT_PORT"
fi

echo -e "${GREEN}🎉 Claude Orchestrator ready at http://localhost:$CLIENT_PORT${NC}"
echo -e "${BLUE}💡 Tip: Close this terminal to keep orchestrator running in background${NC}"

# Keep script running to show logs (optional)
# wait $ORCH_PID
```

**Desktop Shortcut Generator** (`scripts/create-shortcut.sh`):
```bash
#!/bin/bash
# Generate desktop shortcut for Claude Orchestrator

SCRIPT_PATH="$HOME/.local/bin/orchestrator"
DESKTOP_FILE="$HOME/Desktop/claude-orchestrator.desktop"
ICON_PATH="$HOME/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev/client/icon.png"

# Copy startup script to bin
cp scripts/orchestrator-startup.sh "$SCRIPT_PATH"
chmod +x "$SCRIPT_PATH"

# Create desktop shortcut
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Claude Orchestrator
Comment=Multi-workspace Claude development environment
Exec=$SCRIPT_PATH
Icon=$ICON_PATH
Terminal=false
Categories=Development;IDE;
EOF

chmod +x "$DESKTOP_FILE"

echo "✅ Desktop shortcut created: $DESKTOP_FILE"
echo "✅ Command-line shortcut: orchestrator (in ~/.local/bin)"
```

**Installation Script** (`scripts/install.sh`):
```bash
#!/bin/bash
# One-time installation script

echo "🚀 Installing Claude Orchestrator..."

# 1. Install dependencies
npm install

# 2. Create orchestrator config directory
mkdir -p ~/.orchestrator/{workspaces,templates,session-states,logs}

# 3. Migrate existing config (if exists)
if [ -f config.json ]; then
  echo "📦 Migrating existing config..."
  node config/migrate-to-workspaces.js
fi

# 4. Create startup script and shortcuts
./scripts/create-shortcut.sh

# 5. Build Tauri app (optional)
read -p "Build native Tauri app? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  npm run tauri:build
fi

echo "✅ Installation complete!"
echo "💡 Run 'orchestrator' or click the desktop shortcut to start"
```

**Testing**:
- Run `scripts/install.sh` on fresh system
- Click desktop shortcut → orchestrator opens in browser
- Run `orchestrator` command → same result
- Test with orchestrator already running → just opens browser
- Test `orchestrator --no-update` → skips git pull
- Test offline → still works (skips update)

**Success Criteria**:
- ✅ Single command/click to start orchestrator
- ✅ Auto-opens browser when ready
- ✅ Handles "already running" gracefully
- ✅ Works offline (skips update step)
- ✅ Desktop shortcut works
- ✅ Command-line `orchestrator` works
- ✅ Startup takes < 10 seconds (cold start)

---

### 🔗 Phase 7: Quick Links & External Tools (Week 7)
**Goal**: Quick access to external resources

**Files to Create**:
- `client/quick-links.js` - Quick links sidebar component
- `client/link-editor.js` - UI for editing links

**Files to Modify**:
- `client/app.js` - Add quick links to sidebar
- Workspace configs - Add `quickLinks` section

**Key Code**:
```javascript
// client/quick-links.js
class QuickLinks {
  constructor(workspace) {
    this.workspace = workspace;
    this.links = workspace.quickLinks || [];
  }

  render(container) {
    const linksHTML = this.links.map(category => `
      <div class="link-category">
        <h4>${category.category}</h4>
        <ul>
          ${category.links.map(link => this.renderLink(link)).join('')}
        </ul>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="quick-links">
        <h3>Quick Links</h3>
        ${linksHTML}
      </div>
    `;
  }

  renderLink(link) {
    if (link.url) {
      // External URL
      return `
        <li>
          <a href="${link.url}" target="_blank" rel="noopener">
            ${link.label}
            <span class="external-icon">↗</span>
          </a>
        </li>
      `;
    } else if (link.action) {
      // Internal action
      return `
        <li>
          <button class="link-action" data-action="${link.action}">
            ${link.label}
          </button>
        </li>
      `;
    }
  }
}
```

**Sample Quick Links Config**:
```json
{
  "quickLinks": [
    {
      "category": "Monitoring",
      "links": [
        {
          "label": "Sentry Dashboard",
          "url": "https://sentry.io/organizations/yourorg/issues/"
        },
        {
          "label": "Sentry Performance",
          "url": "https://sentry.io/organizations/yourorg/performance/"
        },
        {
          "label": "Error Filters",
          "url": "https://sentry.io/organizations/yourorg/issues/?query=is:unresolved"
        }
      ]
    },
    {
      "category": "Documentation",
      "links": [
        {
          "label": "Hytopia Docs",
          "url": "https://docs.hytopia.com"
        },
        {
          "label": "API Reference",
          "url": "https://docs.hytopia.com/api"
        }
      ]
    },
    {
      "category": "Tools",
      "links": [
        {
          "label": "Performance Analyzer",
          "action": "openPerfAnalyzer"
        },
        {
          "label": "Config Loader",
          "action": "openConfigLoader"
        }
      ]
    }
  ]
}
```

**Testing**:
- Quick links appear in sidebar
- External links open in new tab
- Action links trigger orchestrator actions
- Different workspaces show different links
- Can add/edit/remove links via UI

**Success Criteria**:
- ✅ Quick links sidebar renders
- ✅ External links open correctly
- ✅ Action links trigger functions
- ✅ Links are workspace-specific
- ✅ Link editor UI works

---

### ✨ Phase 8: Polish & Advanced Features (Week 8+)

#### Feature: Workspace Templates Library
- Pre-built templates for common project types
- Templates: `game-hytopia`, `game-unity`, `web-nextjs`, `web-react`, `api-express`, `api-fastapi`, `data-jupyter`, `docs-markdown`
- Each template includes sensible defaults for buttons, terminal count, launch profiles

#### Feature: Workspace Export/Import
```bash
# Export workspace
orchestrator export hyfire > hyfire-workspace.json

# Import workspace
orchestrator import epic-survivors-workspace.json
```

#### Feature: Workspace Groups
```javascript
{
  "groups": {
    "games": ["hyfire", "epic-survivors"],
    "web": ["carm-crypto", "personal-site"],
    "writing": ["book", "blog"]
  }
}
```

#### Feature: Smart Workspace Detection
- Detect current git repo → suggest switching to matching workspace
- Track workspace usage patterns → recommend workspace
- "Last used" indicator on each workspace

#### Feature: Performance Dashboard (HyFire-specific)
- Parse performance logs
- Show graphs: FPS, memory, network
- Compare performance across builds
- Integrated into HyFire workspace

#### Feature: Embedded Sentry Panel
- Show error count badge on workspace icon
- Quick error viewer (iframe embed)
- Click error → jump to relevant code file

#### Feature: Multi-Model Support
- UI for swapping Claude models (Opus, Sonnet, Haiku)
- Per-terminal model selection
- Token usage tracking per model
- Cost estimation

#### Feature: Claude Context Management
- Display token usage per session
- Session checkpoint saving
- Context recovery after restart
- Warning when approaching limits

---

## File Structure After Implementation

```
claude-orchestrator-dev/
├── server/
│   ├── index.js                        # (Modified) Integrate all services
│   ├── sessionManager.js               # (Modified) Workspace support
│   ├── workspaceManager.js             # (New) Core workspace management
│   ├── buttonActionRegistry.js         # (New) Action handlers
│   ├── launchProfileManager.js         # (New) Launch profile handling
│   ├── workspaceCreator.js             # (New) Workspace creation backend
│   ├── statusDetector.js
│   ├── gitHelper.js
│   ├── notificationService.js
│   └── schemas/
│       ├── workspace-schema.json       # (New) Workspace config schema
│       └── template-schema.json        # (New) Template schema
├── client/
│   ├── app.js                          # (Modified) Workspace UI integration
│   ├── index.html                      # (Modified) Add workspace UI elements
│   ├── workspace-ui.js                 # (New) Workspace UI manager
│   ├── workspace-switcher.js           # (New) Switcher dropdown
│   ├── workspace-wizard.js             # (New) Creation wizard
│   ├── button-renderer.js              # (New) Dynamic button rendering
│   ├── quick-links.js                  # (New) Quick links sidebar
│   ├── link-editor.js                  # (New) Link management UI
│   ├── repo-scanner.js                 # (New) Repository scanning
│   └── styles.css                      # (Modified) Workspace UI styles
├── scripts/
│   ├── orchestrator-startup.sh         # (New) One-click startup script
│   ├── create-shortcut.sh              # (New) Desktop shortcut generator
│   └── install.sh                      # (New) Installation script
├── config/
│   └── migrate-to-workspaces.js        # (New) Config migration tool
└── ~/.orchestrator/                    # (New) User config directory
    ├── config.json                     # Master config
    ├── workspaces/
    │   ├── hyfire.json
    │   ├── epic-survivors.json
    │   ├── book.json
    │   └── carm-crypto.json
    ├── templates/
    │   ├── game-development.json
    │   ├── web-application.json
    │   └── simple-project.json
    ├── session-states/
    │   ├── hyfire/
    │   └── epic-survivors/
    └── logs/
        └── orchestrator.log
```

## Testing Strategy

### Unit Tests
- WorkspaceManager: load, switch, create
- ButtonActionRegistry: register, execute actions
- LaunchProfileManager: build commands correctly
- Workspace validation: schema compliance

### Integration Tests
- Workspace switching: preserves session states
- Button actions: trigger correct commands
- Launch profiles: apply flags correctly
- Quick links: external and internal links work

### E2E Tests
- Complete workflow: create workspace → switch → use buttons → switch back
- Startup script: one-click launch works
- Wizard: create new workspace end-to-end
- Performance: workspace switch < 500ms

### User Acceptance Testing
- Reduce startup friction: < 10 seconds cold start
- Workspace switching: intuitive and fast
- Button customization: users can add/remove easily
- Overall UX: feels natural and productive

## Rollout Plan

### Phase 1-2 (Foundation + UI)
- Release: **Beta v2.0.0-alpha.1**
- Users: Internal testing only (you)
- Features: Workspace switching (2-3 hardcoded workspaces)

### Phase 3-4 (Buttons + Profiles)
- Release: **Beta v2.0.0-alpha.2**
- Users: Internal testing
- Features: Custom buttons, launch profiles

### Phase 5-6 (Wizard + Startup)
- Release: **Beta v2.0.0-beta.1**
- Users: Early adopters (if applicable)
- Features: Full workspace creation, one-click startup

### Phase 7-8 (Polish + Advanced)
- Release: **v2.0.0**
- Users: General availability
- Features: Complete workspace management system

## Success Metrics

### Quantitative
- Startup time: **2 minutes → 10 seconds** (12x improvement)
- Context switch time: **30 seconds → 5 seconds** (6x improvement)
- Config editing: **100% manual → 0% manual** (wizard handles it)
- Quick link access: **15 seconds → 2 seconds** (7.5x improvement)

### Qualitative
- "Feels effortless to switch between projects"
- "Never have to think about startup process"
- "Can focus on work, not fighting tools"
- "Everything I need is right here"

## Next Steps

1. **Review this document** with user (you)
2. **Confirm priorities**: Which phases are most critical?
3. **Start Phase 1**: Implement WorkspaceManager backend
4. **Iterate**: Build, test, get feedback, improve
5. **Document as we go**: User guide, API docs, video tutorials

---

**Document Version**: 1.0
**Date**: 2025-09-27
**Status**: Ready for Implementation