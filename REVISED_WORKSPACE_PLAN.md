# Claude Orchestrator: REVISED Workspace Management Plan
## Based on Actual Current Implementation

**Date**: 2025-09-27
**Status**: Ready for Implementation

---

## 🎯 Executive Summary

The Claude Orchestrator is **already highly sophisticated** with advanced per-worktree launch settings, user preferences, and HyFire 2-specific game configuration. The task is NOT to rebuild what exists, but to **generalize** the system to support multiple projects while **preserving** all the polished HyFire features.

### Current State (What's ALREADY Built)
✅ **Comprehensive launch settings modal** - Game modes, timing, server config, advanced options
✅ **Per-worktree settings overrides** - Global + per-worktree customization
✅ **User settings service** - Global and per-terminal Claude flags, auto-start
✅ **8 worktrees** - HyFire 2 with master + work1-8
✅ **Server status tracking** - Running/stopped, port management
✅ **GitHub integration** - PR links, branch display
✅ **Activity filtering** - Show active/all worktrees
✅ **Visibility toggling** - Show/hide specific worktrees
✅ **Startup options** - Fresh/Continue/Resume with YOLO mode
✅ **Build production** - ZIP packaging
✅ **Replay viewer** - Built-in
✅ **Code review assignment** - Integrated
✅ **Diff viewer** - Advanced analysis tool

### What's Missing (The Actual Gap)
❌ **Multi-project support** - Currently hardcoded to HyFire 2
❌ **Top-level dashboard** - No workspace selector/launcher
❌ **Project-specific launch settings** - HyFire settings won't apply to websites/MonoGame
❌ **Dynamic worktree creation** - Currently fixed at 8
❌ **Repository discovery** - No auto-detection of available projects
❌ **Project type awareness** - Hytopia games, MonoGame games, websites, Ruby on Rails, etc.
❌ **Shared/private repo handling** - No consideration for teammate access (NROCKX sees 80%, not 100%)
❌ **Global shortcuts** - No persistent links (GitHub, Sentry, etc.)
❌ **Cross-workspace notifications** - No way to mute/manage across workspaces
❌ **One-click orchestrator startup** - Still manual cd/npm run

---

## 📂 Current Architecture Analysis

### Folder Structure

```
/home/ab/
├── HyFire2/                           # Current project (8 worktrees + master)
│   ├── master/
│   ├── work1/
│   ├── work2/
│   └── ... work8/
├── GitHub/
│   ├── games/
│   │   ├── hytopia/                   # Hytopia SDK (has CLAUDE.md)
│   │   │   └── games/
│   │   │       └── HyFire2/           # Actual HyFire 2 source
│   │   ├── monogame/                  # MonoGame projects (has CLAUDE.md)
│   │   ├── minecraft/
│   │   ├── rust/
│   │   └── web/
│   ├── website/                       # Website projects (has CLAUDE.md)
│   ├── tools/
│   │   └── automation/
│   │       └── claude-orchestrator/
│   │           └── claude-orchestrator-dev/  # THIS REPO
│   └── CLAUDE.md                      # Root GitHub CLAUDE.md
├── .claude/
│   ├── CLAUDE.md                      # Global CLAUDE config
│   ├── installed/                     # Cloned agent repos
│   │   ├── ai-standards/
│   │   ├── github/
│   │   ├── hytopia/
│   │   ├── monogame/
│   │   └── website/
│   ├── projects/                      # Claude Code project sessions
│   ├── commands/                      # Slash commands
│   └── hooks/                         # Safety hooks
└── CLAUDE.md                          # Home directory CLAUDE.md
```

### Current Orchestrator Data Flow

```
User Settings (client side)
├─ localStorage: server-launch-settings
│   ├─ global: { envVars, nodeOptions, gameArgs }
│   └─ perWorktree: { work1: {...}, work2: {...} }
└─ localStorage: settings (theme, notifications, etc.)

Server Settings (server side)
└─ user-settings.json
    ├─ global: { claudeFlags, autoStart, terminal }
    └─ perTerminal: { "work1-claude": {...} }

Session State (runtime)
├─ sessions: Map<sessionId, session>
├─ visibleTerminals: Set<sessionId>
├─ serverStatuses: Map<sessionId, 'running'|'idle'>
├─ githubLinks: Map<sessionId, prUrl>
└─ sessionActivity: Map<sessionId, 'active'>
```

### Current Launch Settings (HyFire 2 Specific)

The `showServerLaunchSettings()` modal includes:

**Game Rules Tab**:
- Mode: Casual, Competitive, Deathmatch, Custom
- Max Rounds: 1-30
- Team Size: 1v1 to 10v10
- Min Players: 1-10
- Toggles: Friendly Fire, Auto Bots, Spectators, Strict Teams

**Timing Settings Tab**:
- Round Time: 30-300s
- Buy Time: 5-60s
- Warmup Time: 0-120s
- Bomb Timer: 20-60s
- Pre-Round: 0-10s
- Round End: 0-15s

**Server Settings Tab**:
- Environment: Development/Production
- Memory Limit: 1-16GB
- Server Port: Auto-assigned (8080 + worktreeNum)
- Debug Mode toggle

**Advanced Tab**:
- Extra Environment Variables
- Extra Node Options
- Extra Game Arguments
- Command Preview (shows actual command)

**All settings** can be:
- Global (applies to all worktrees by default)
- Per-worktree override (work1 can have different settings than work2)

---

## 🏗️ Revised Architecture: Multi-Project Workspace System

### Core Concept: Workspace Types

Instead of one hardcoded "HyFire 2" setup, the orchestrator needs to support multiple **workspace types**:

| Workspace Type | Description | Terminals | Launch Settings | Examples |
|----------------|-------------|-----------|-----------------|----------|
| **hytopia-game** | Hytopia SDK game projects | 1-16 Claude+Server pairs | HyFire settings (game modes, timing, etc.) | HyFire 2, Epic Survivors |
| **monogame-game** | MonoGame C# game projects | 1-8 Claude+Server pairs | MonoGame settings (build config, content pipeline) | MonoGame projects |
| **website** | Web applications | 1-4 Claude+Server pairs | Web settings (dev server, build, deploy) | Carm Crypto, personal site |
| **ruby-rails** | Ruby on Rails applications | 1-4 Claude+Server pairs | Rails settings (db, server, env) | Pythe projects |
| **simple** | Scripts, writing, docs | 1-4 Claude terminals only | No server settings | Book, scripts |

### Workspace Definition Schema

```javascript
// ~/.orchestrator/workspaces/hyfire2.json
{
  "id": "hyfire2",
  "name": "HyFire 2",
  "type": "hytopia-game",
  "icon": "🔥",
  "description": "Tactical 5v5 shooter for Hytopia",

  "repository": {
    "path": "/home/ab/HyFire2",
    "masterBranch": "master",
    "remote": "https://github.com/web3dev1337/hyfire2"
  },

  "worktrees": {
    "enabled": true,
    "count": 8,
    "namingPattern": "work{n}",  // work1, work2, etc.
    "autoCreate": false  // Don't auto-create all 8 on first load
  },

  "terminals": {
    "pairs": 8,  // Max 8 Claude+Server pairs
    "defaultVisible": [1, 2, 3],  // work1-3 visible by default
    "layout": "dynamic"  // Auto-adjust grid based on visible count
  },

  "launchSettings": {
    "type": "hytopia-game",  // References a template
    "defaults": {
      "envVars": "AUTO_START_WITH_BOTS=true NODE_ENV=development",
      "nodeOptions": "--max-old-space-size=4096",
      "gameArgs": "--mode=casual --roundtime=60 --buytime=10 --warmup=5 --maxrounds=13 --teamsize=5"
    },
    "perWorktree": {}  // Overrides loaded from localStorage
  },

  "shortcuts": [
    {
      "label": "Play in Hytopia",
      "icon": "🎮",
      "action": "playInHytopia",
      "visibility": "server-running"  // Only show when server is running
    },
    {
      "label": "Build Production",
      "icon": "📦",
      "action": "buildProduction"
    },
    {
      "label": "Replay Viewer",
      "icon": "📹",
      "action": "openReplayViewer",
      "visibility": "claude-session"  // Only show on Claude terminals
    }
  ],

  "quickLinks": [
    {
      "category": "Monitoring",
      "links": [
        { "label": "Sentry Dashboard", "url": "https://sentry.io/..." },
        { "label": "Game Analytics", "url": "https://..." }
      ]
    },
    {
      "category": "Documentation",
      "links": [
        { "label": "Hytopia Docs", "url": "https://docs.hytopia.com" },
        { "label": "Game Design Doc", "url": "https://..." }
      ]
    }
  ],

  "theme": {
    "primaryColor": "#ff6b35",
    "icon": "🔥"
  }
}
```

### Launch Settings Templates

Since different project types need different launch settings, create templates:

```javascript
// ~/.orchestrator/templates/launch-settings/hytopia-game.json
{
  "id": "hytopia-game",
  "name": "Hytopia Game Settings",
  "modalStructure": {
    "tabs": [
      {
        "id": "game-rules",
        "label": "Game Rules",
        "fields": [
          {
            "id": "mode",
            "label": "Game Mode",
            "type": "radio",
            "options": ["casual", "competitive", "deathmatch", "custom"],
            "default": "casual",
            "flagFormat": "--mode={value}"
          },
          {
            "id": "maxRounds",
            "label": "Max Rounds",
            "type": "slider",
            "min": 1, "max": 30, "default": 13,
            "flagFormat": "--maxrounds={value}"
          },
          // ... all the HyFire settings
        ]
      },
      {
        "id": "timing",
        "label": "Timing Settings",
        "fields": [/* ... */]
      },
      {
        "id": "server",
        "label": "Server Settings",
        "fields": [/* ... */]
      },
      {
        "id": "advanced",
        "label": "Advanced",
        "fields": [/* ... */]
      }
    ]
  }
}
```

```javascript
// ~/.orchestrator/templates/launch-settings/website.json
{
  "id": "website",
  "name": "Web Application Settings",
  "modalStructure": {
    "tabs": [
      {
        "id": "server",
        "label": "Dev Server",
        "fields": [
          {
            "id": "port",
            "label": "Port",
            "type": "number",
            "default": 3000,
            "envFormat": "PORT={value}"
          },
          {
            "id": "hot-reload",
            "label": "Hot Reload",
            "type": "toggle",
            "default": true,
            "envFormat": "HOT_RELOAD={value}"
          }
        ]
      },
      {
        "id": "build",
        "label": "Build Settings",
        "fields": [
          {
            "id": "minify",
            "label": "Minify",
            "type": "toggle",
            "default": false
          },
          {
            "id": "sourcemaps",
            "label": "Source Maps",
            "type": "toggle",
            "default": true
          }
        ]
      }
    ]
  }
}
```

### Global Configuration

```javascript
// ~/.orchestrator/config.json
{
  "version": "2.0.0",
  "activeWorkspace": "hyfire2",  // Currently selected workspace
  "workspaceDirectory": "/home/ab/.orchestrator/workspaces",

  "discovery": {
    "scanPaths": [
      "/home/ab/GitHub/games",
      "/home/ab/GitHub/website",
      "/home/ab/GitHub/tools"
    ],
    "exclude": ["node_modules", ".git", "dist", "build"]
  },

  "globalShortcuts": [
    {
      "label": "GitHub Profile",
      "url": "https://github.com/web3dev1337",
      "icon": "💻"
    },
    {
      "label": "Claude Code Docs",
      "url": "https://docs.claude.com",
      "icon": "📚"
    }
  ],

  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },

  "ui": {
    "theme": "dark",
    "startupDashboard": true,  // Show dashboard on load (not last workspace)
    "rememberLastWorkspace": true
  },

  "orchestratorStartup": {
    "autoUpdate": true,
    "openBrowserOnStart": true,
    "checkForNewRepos": true
  }
}
```

---

## 🎨 New UI Components

### 1. Top-Level Dashboard (New Screen)

When orchestrator starts, show a **dashboard** instead of immediately loading last workspace:

```
┌────────────────────────────────────────────────────────────┐
│  🎯 Claude Orchestrator Dashboard                          │
├────────────────────────────────────────────────────────────┤
│                                                              │
│  Active Workspaces                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 🔥 HyFire 2  │  │ ⚔️ Epic      │  │ 📖 Book      │    │
│  │              │  │   Survivors   │  │              │    │
│  │ 3/8 active   │  │ 0/6 active    │  │ 1/1 active   │    │
│  │ Last: 2h ago │  │ Last: 3d ago  │  │ Last: 1h ago │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                              │
│  All Workspaces                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 💰 Carm      │  │ 🌐 Website   │  │ ➕ Create    │    │
│  │   Crypto     │  │              │  │    New       │    │
│  │ 0/4 active   │  │ 0/2 active    │  │ Workspace    │    │
│  │ Last: 1w ago │  │ Last: 2w ago  │  │              │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                              │
│  🔗 Quick Links                                             │
│  [💻 GitHub] [📊 Sentry] [📚 Docs] [⚙️ Settings]          │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

**Dashboard Features**:
- **Workspace Cards**: Click to open workspace
- **Activity Indicators**: Show how many terminals are active
- **Last Used**: Track when you last worked on each project
- **Create New**: Launch workspace creation wizard
- **Global Quick Links**: Always accessible shortcuts
- **Search**: Filter workspaces by name/type

### 2. In-Workspace Header (Modified)

When inside a workspace, add workspace switcher:

```
┌────────────────────────────────────────────────────────────┐
│ 🏠 Dashboard | 🔥 HyFire 2 ▼ | 🔔 | ⚙️ | ●●● Connected   │
└────────────────────────────────────────────────────────────┘
```

Click "🔥 HyFire 2 ▼" dropdown:
```
┌─────────────────┐
│ 🔥 HyFire 2  ✓  │ ← Current
│ ⚔️ Epic Survivors│
│ 📖 Book          │
│ 💰 Carm Crypto   │
│ ─────────────────│
│ 🏠 Dashboard     │
└─────────────────┘
```

### 3. Workspace Creation Wizard (New)

Multi-step wizard for creating new workspaces:

**Step 1: Choose Type**
```
What type of project?
┌─────────────────────────────────────┐
│ ○ Hytopia Game                      │
│   Full game dev environment         │
│                                     │
│ ○ MonoGame Game                     │
│   C# game development               │
│                                     │
│ ○ Website/Web App                   │
│   Frontend or fullstack web         │
│                                     │
│ ○ Ruby on Rails                     │
│   Rails application                 │
│                                     │
│ ○ Simple Project                    │
│   Scripts, docs, writing            │
│                                     │
│ ○ Custom                            │
│   Build from scratch                │
└─────────────────────────────────────┘
```

**Step 2: Repository**
```
Select Repository

Auto-detected Projects:
  ● /home/ab/GitHub/games/hytopia/games/EpicSurvivors
  ● /home/ab/GitHub/website/carm-crypto
  ● /home/ab/GitHub/games/monogame/AdventureGame

Or enter custom path:
[________________________________]  [Browse...]
```

**Step 3: Worktrees**
```
Worktree Configuration

☑ Enable Git Worktrees
  Number of worktrees: [8  ▼]

  ○ Create all worktrees now
  ● Create on-demand (recommended)

  Naming pattern: work{n}
```

**Step 4: Settings**
```
Initial Settings

Workspace Name: [Epic Survivors    ]
Icon: [⚔️  ▼]

Default visible terminals: [1, 2, 3]

☑ Import launch settings from HyFire 2
☐ Start with empty settings
```

**Step 5: Review & Create**
```
Review Workspace

Name: Epic Survivors
Type: hytopia-game
Repository: /home/ab/GitHub/games/hytopia/games/EpicSurvivors
Worktrees: 8 (on-demand)
Terminals: 8 Claude+Server pairs

[Cancel]  [Create Workspace]
```

### 4. Notifications Panel (Enhanced)

Handle cross-workspace notifications:

```
┌─────────────────────────────────────┐
│ Notifications                       │
├─────────────────────────────────────┤
│ 🔥 HyFire 2                         │
│   ● work3-server: Build complete    │
│   ● work1-claude: PR ready #142     │
│   [Mute] [View]                     │
│                                     │
│ ⚔️ Epic Survivors (Muted)           │
│   ○ work1-server: Error              │
│   [Unmute]                          │
│                                     │
│ 📖 Book                             │
│   ● work1-claude: Export complete    │
│   [View]                            │
└─────────────────────────────────────┘
```

**Features**:
- Per-workspace muting
- Background notifications from inactive workspaces
- Click notification → switch to that workspace

---

## 🔧 Implementation Plan (Revised)

### Phase 1: Multi-Workspace Backend (Week 1-2)

**Goal**: Support loading multiple workspace configs without breaking current HyFire 2 setup

#### New Files:
```
server/workspaceManager.js          - Workspace loading, switching, creation
server/workspaceTypes.js            - Type definitions & validation
server/workspaceDiscovery.js        - Auto-detect projects in filesystem
client/workspace-dashboard.js       - Dashboard UI component
client/workspace-switcher.js        - Header dropdown component
```

#### Modified Files:
```
server/index.js                     - Integrate WorkspaceManager
server/sessionManager.js            - Accept workspace config, create sessions dynamically
config.json → ~/.orchestrator/config.json  - New location & structure
```

#### Key Changes:
1. `WorkspaceManager` service:
   ```javascript
   class WorkspaceManager {
     constructor() {
       this.workspaces = new Map();
       this.activeWorkspace = null;
       this.configPath = '/home/ab/.orchestrator';
     }

     async loadWorkspaces() {
       // Load all workspace configs from ~/.orchestrator/workspaces/
     }

     async switchWorkspace(workspaceId) {
       // 1. Save current session states
       // 2. Load new workspace config
       // 3. Reconfigure SessionManager
       // 4. Emit 'workspace-changed' event to clients
     }

     getActiveWorkspace() {
       return this.activeWorkspace;
     }

     listWorkspaces() {
       return Array.from(this.workspaces.values());
     }
   }
   ```

2. Create default HyFire 2 workspace config from current setup:
   ```bash
   node scripts/migrate-to-workspaces.js
   # Creates ~/.orchestrator/workspaces/hyfire2.json
   ```

3. SessionManager becomes workspace-aware:
   ```javascript
   // Before: hardcoded 8 sessions
   for (let i = 1; i <= 8; i++) {
     this.createSession(`work${i}-claude`, 'claude', ...);
     this.createSession(`work${i}-server`, 'server', ...);
   }

   // After: driven by workspace config
   const workspace = workspaceManager.getActiveWorkspace();
   for (let i = 1; i <= workspace.terminals.pairs; i++) {
     if (workspace.worktrees.autoCreate || this.worktreeExists(i)) {
       this.createSession(`work${i}-claude`, 'claude', workspace);
       this.createSession(`work${i}-server`, 'server', workspace);
     }
   }
   ```

**Testing**:
- Load orchestrator → automatically migrates to workspace system
- HyFire 2 workspace works exactly as before
- Can manually create a second workspace config file
- Backend can switch between workspaces (no UI yet)

**Success Criteria**:
✅ Backward compatible - existing HyFire 2 setup still works
✅ WorkspaceManager loads multiple configs
✅ SessionManager respects workspace.terminals.pairs count
✅ No breaking changes to current functionality

---

### Phase 2: Dashboard & Workspace Switching UI (Week 2-3)

**Goal**: Users can switch workspaces via dashboard/dropdown

#### New Files:
```
client/dashboard.html               - Dashboard page (or embedded)
client/dashboard.js                 - Dashboard logic
client/workspace-card.js            - Workspace card component
```

#### Modified Files:
```
client/index.html                   - Add dashboard mode vs workspace mode
client/app.js                       - Handle workspace switching, state persistence
server/index.js                     - Add workspace switching endpoint
```

#### Key Features:

1. **Startup Behavior**:
   ```javascript
   // On orchestrator load:
   if (config.ui.startupDashboard) {
     showDashboard();
   } else if (config.ui.rememberLastWorkspace && lastWorkspace) {
     loadWorkspace(lastWorkspace);
   } else {
     showDashboard();
   }
   ```

2. **Dashboard View**:
   - Grid of workspace cards
   - Shows workspace name, icon, type, activity
   - Click card → load workspace
   - "Create New" button → wizard
   - Global shortcuts at bottom

3. **In-Workspace View**:
   - Current workspace header with dropdown
   - Click dropdown → list of workspaces + "Dashboard" option
   - Select workspace → smooth transition

4. **Workspace Transition**:
   ```javascript
   async switchWorkspace(newWorkspaceId) {
     // 1. Show loading overlay
     this.showTransitionOverlay("Switching to " + newWorkspace.name);

     // 2. Save current state
     this.saveSessionStates(currentWorkspace);

     // 3. Request workspace switch from server
     await this.socket.emit('switch-workspace', { workspaceId: newWorkspaceId });

     // 4. Server reconfigures and sends new session list
     this.socket.once('workspace-changed', (workspace) => {
       // 5. Rebuild entire UI
       this.currentWorkspace = workspace;
       this.rebuildTerminalGrid();
       this.rebuildSidebar();
       this.updateHeader();

       // 6. Restore session states if exist
       this.restoreSessionStates(workspace);

       // 7. Hide overlay
       this.hideTransitionOverlay();
     });
   }
   ```

**Testing**:
- Dashboard loads on startup
- Can click workspace card → loads workspace
- Workspace dropdown shows all workspaces
- Can switch between HyFire 2 and a test workspace (e.g., Book)
- Terminal count changes (8 pairs → 1 pair)
- Session states preserved when switching back

**Success Criteria**:
✅ Dashboard UI functional
✅ Workspace switching works
✅ UI updates correctly (terminal count, buttons, etc.)
✅ No data loss when switching
✅ Smooth transitions (< 1 second)

---

### Phase 3: Launch Settings Templates (Week 3-4)

**Goal**: Different workspace types have appropriate launch settings

#### Challenge:
The current `showServerLaunchSettings()` function generates a MASSIVE HTML string hardcoded for HyFire. We need to make this **template-driven**.

#### Approach:

1. **Extract current HyFire settings to JSON template**:
   ```bash
   node scripts/extract-launch-template.js
   # Creates ~/.orchestrator/templates/launch-settings/hytopia-game.json
   ```

2. **Create template renderer**:
   ```javascript
   // client/launch-settings-renderer.js
   class LaunchSettingsRenderer {
     constructor(workspace) {
       this.workspace = workspace;
       this.template = this.loadTemplate(workspace.launchSettings.type);
     }

     loadTemplate(templateId) {
       // Fetch template JSON from server
       return fetch(`/api/launch-templates/${templateId}`).then(r => r.json());
     }

     renderModal(sessionId) {
       const modal = document.createElement('div');
       modal.id = 'launch-settings-modal';
       modal.className = 'modal';

       // Generate tabs from template
       const tabs = this.template.modalStructure.tabs.map(tab => {
         return this.renderTab(tab);
       }).join('');

       modal.innerHTML = `
         <div class="modal-content launch-settings-modal">
           <div class="modal-header">
             <h2>🚀 Launch Settings - ${this.workspace.name}</h2>
             <button class="close-btn">×</button>
           </div>
           <div class="modal-tabs">
             ${tabs}
           </div>
           <div class="modal-footer">
             <button onclick="applySettings()">Apply & Launch</button>
             <button onclick="closeModal()">Cancel</button>
           </div>
         </div>
       `;

       return modal;
     }

     renderTab(tab) {
       // Render fields based on type (slider, toggle, radio, etc.)
       const fields = tab.fields.map(field => this.renderField(field)).join('');
       return `
         <div class="tab-content" id="tab-${tab.id}">
           <h3>${tab.label}</h3>
           ${fields}
         </div>
       `;
     }

     renderField(field) {
       switch (field.type) {
         case 'slider':
           return this.renderSlider(field);
         case 'toggle':
           return this.renderToggle(field);
         case 'radio':
           return this.renderRadio(field);
         // ... etc
       }
     }
   }
   ```

3. **Create templates for other project types**:
   - `hytopia-game.json` (already done - current HyFire settings)
   - `monogame-game.json` (build config, content pipeline)
   - `website.json` (dev server, build, deploy)
   - `ruby-rails.json` (rails server, db, env)
   - `simple.json` (minimal or no settings)

**Testing**:
- HyFire 2 workspace still shows full game settings modal
- Create a "Book" workspace (type: simple) → no launch settings or minimal settings
- Create a "Website" workspace → shows web-appropriate settings

**Success Criteria**:
✅ Templates loaded from JSON
✅ Modal renders dynamically based on template
✅ HyFire settings unchanged (backward compatible)
✅ New workspace types have appropriate settings
✅ No code duplication

---

### Phase 4: Workspace Creation Wizard (Week 4-5)

**Goal**: Create new workspaces without editing JSON

#### Implementation:

1. **Wizard Component**:
   ```javascript
   // client/workspace-wizard.js
   class WorkspaceWizard {
     constructor() {
       this.currentStep = 1;
       this.data = {};
     }

     show() {
       this.renderStep(1);
     }

     renderStep(step) {
       switch (step) {
         case 1: return this.renderTypeSelection();
         case 2: return this.renderRepositorySelection();
         case 3: return this.renderWorktreeConfig();
         case 4: return this.renderInitialSettings();
         case 5: return this.renderReview();
       }
     }

     async scanRepositories() {
       // Call server endpoint to scan filesystem
       return await fetch('/api/workspaces/scan-repos').then(r => r.json());
     }

     async createWorkspace() {
       // Send workspace config to server
       const response = await fetch('/api/workspaces', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(this.data)
       });

       const workspace = await response.json();

       // Optionally create worktrees
       if (this.data.createWorktreesNow) {
         await this.initializeWorktrees(workspace);
       }

       return workspace;
     }
   }
   ```

2. **Repository Scanner**:
   ```javascript
   // server/workspaceDiscovery.js
   class WorkspaceDiscovery {
     async scanForProjects(scanPaths) {
       const projects = [];

       for (const basePath of scanPaths) {
         const entries = await fs.readdir(basePath, { withFileTypes: true });

         for (const entry of entries) {
           if (!entry.isDirectory()) continue;

           const projectPath = path.join(basePath, entry.name);
           const projectInfo = await this.analyzeProject(projectPath);

           if (projectInfo) {
             projects.push(projectInfo);
           }
         }
       }

       return projects;
     }

     async analyzeProject(projectPath) {
       // Check for indicators of project type
       const hasPackageJson = await this.fileExists(path.join(projectPath, 'package.json'));
       const hasCsproj = await this.fileExists(path.join(projectPath, '*.csproj'));
       const hasGemfile = await this.fileExists(path.join(projectPath, 'Gemfile'));

       // Check for .git
       const isGitRepo = await this.fileExists(path.join(projectPath, '.git'));

       // Determine project type
       let type = 'simple';
       if (hasPackageJson) {
         const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json')));
         if (pkg.dependencies?.hytopia) type = 'hytopia-game';
         else type = 'website';
       } else if (hasCsproj) {
         type = 'monogame-game';
       } else if (hasGemfile) {
         type = 'ruby-rails';
       }

       return {
         name: path.basename(projectPath),
         path: projectPath,
         type,
         isGitRepo
       };
     }
   }
   ```

3. **Worktree Initializer**:
   ```javascript
   // server/worktreeHelper.js
   class WorktreeHelper {
     async createWorktrees(workspace, count) {
       const basePath = workspace.repository.path;
       const masterBranch = workspace.repository.masterBranch || 'main';

       for (let i = 1; i <= count; i++) {
         const worktreeName = workspace.worktrees.namingPattern.replace('{n}', i);
         const worktreePath = path.join(basePath, worktreeName);

         // git worktree add work1 master
         await exec(`git worktree add ${worktreePath} ${masterBranch}`, {
           cwd: path.join(basePath, 'master')
         });
       }
     }

     async removeWorktrees(workspace) {
       // git worktree remove work1
       // ... for each worktree
     }
   }
   ```

**Testing**:
- Click "Create New Workspace" on dashboard
- Wizard scans and finds projects in ~/GitHub/
- Select "Epic Survivors" repo
- Choose "hytopia-game" type
- Configure 6 worktrees (on-demand)
- Create workspace → appears in dashboard
- Load workspace → 6 terminal pairs available

**Success Criteria**:
✅ Wizard UI functional
✅ Repository scanning works
✅ Can create workspace from wizard
✅ New workspace immediately usable
✅ Optional worktree creation works
✅ No manual JSON editing needed

---

### Phase 5: Dynamic Worktree Management (Week 5-6)

**Goal**: Create worktrees on-demand, not all at once

#### Current Issue:
HyFire 2 has 8 worktrees pre-created (work1-8). For new projects, we don't want to force users to create all worktrees upfront.

#### Solution: On-Demand Creation

1. **Lazy Worktree Creation**:
   ```javascript
   // server/sessionManager.js
   async createSession(sessionId, type, workspace) {
     const worktreeId = this.getWorktreeIdFromSessionId(sessionId);
     const worktreePath = this.getWorktreePath(workspace, worktreeId);

     // Check if worktree exists
     if (!fs.existsSync(worktreePath)) {
       if (workspace.worktrees.enabled && workspace.worktrees.autoCreate === false) {
         // On-demand creation
         logger.info(`Worktree ${worktreeId} doesn't exist, creating on-demand`);
         await this.worktreeHelper.createWorktree(workspace, worktreeId);
       } else {
         logger.error(`Worktree ${worktreeId} doesn't exist and auto-create is disabled`);
         throw new Error(`Worktree ${worktreeId} not found`);
       }
     }

     // Now create PTY session as usual
     const pty = spawn('bash', [], {
       cwd: worktreePath,
       // ... other options
     });

     // Store session
     this.sessions.set(sessionId, {
       sessionId,
       type,
       pty,
       worktreeId,
       workspace: workspace.id
     });
   }
   ```

2. **UI for Creating Additional Worktrees**:
   ```
   Sidebar:
   ┌─────────────────┐
   │ Worktrees       │
   ├─────────────────┤
   │ 👁 1 - master   │
   │ 👁 2 - feature  │
   │ 🚫 3 - (none)   │
   │ ─────────────────│
   │ + Add Worktree  │ ← New button
   └─────────────────┘
   ```

   Click "+ Add Worktree" → Shows modal:
   ```
   Create New Worktree

   Number: [4  ▼] (next available)
   Base branch: [master  ▼]

   [Create] [Cancel]
   ```

3. **Worktree Removal**:
   ```javascript
   async removeWorktree(workspace, worktreeId) {
     // 1. Close any active sessions in this worktree
     this.closeWorktreeSessions(worktreeId);

     // 2. Remove git worktree
     await this.worktreeHelper.removeWorktree(workspace, worktreeId);

     // 3. Update UI
     this.emit('worktree-removed', { worktreeId });
   }
   ```

**Testing**:
- Create "Epic Survivors" workspace with 6 worktrees, on-demand mode
- Initially only work1 exists
- Show work2 in sidebar → triggers creation
- work2 appears after ~2 seconds
- Can create work3, work4, etc. on-demand
- Can remove worktree 4 → disappears from sidebar

**Success Criteria**:
✅ On-demand worktree creation works
✅ UI provides feedback during creation
✅ Can create/remove worktrees dynamically
✅ No need to pre-create all worktrees
✅ Performance: worktree creation < 3 seconds

---

### Phase 6: Repository Access & Sharing (Week 6-7)

**Goal**: Handle shared vs private repos (NROCKX sees 80%, not 100%)

#### Challenge:
User (web3dev1337) has ~100 repos. Teammate (NROCKX) has access to ~80 repos (games, tools, Epic Survivors, Hytopia stuff) but NOT:
- Book project (private)
- Patent ideas (private)
- Personal scripts (private)
- Carm Crypto (private - not shared with teammate)

When creating workspaces, need to consider **repository access**.

#### Solution: Access Levels

1. **Workspace Metadata**:
   ```javascript
   // ~/.orchestrator/workspaces/book.json
   {
     "id": "book",
     "name": "Book Writing",
     "access": "private",  // or "shared", "team"
     // ... rest of config
   }
   ```

2. **Global Config**:
   ```javascript
   // ~/.orchestrator/config.json
   {
     "user": {
       "username": "web3dev1337",
       "teammates": [
         {
           "username": "NROCKX",
           "access": "team",  // Can see workspaces marked "shared" or "team"
           "repos": [
             "hyfire2",
             "epic-survivors",
             // ... list of accessible repos
           ]
         }
       ]
     }
   }
   ```

3. **Workspace Filtering**:
   ```javascript
   // server/workspaceManager.js
   listWorkspaces(requestingUser) {
     const allWorkspaces = Array.from(this.workspaces.values());

     // If main user, show all
     if (requestingUser === config.user.username) {
       return allWorkspaces;
     }

     // If teammate, filter by access
     const teammate = config.user.teammates.find(t => t.username === requestingUser);
     if (!teammate) return [];

     return allWorkspaces.filter(ws => {
       if (ws.access === 'private') return false;
       if (ws.access === 'shared' || ws.access === 'team') {
         // Check if teammate has access to this repo
         return teammate.repos.includes(ws.id);
       }
       return false;
     });
   }
   ```

4. **UI Indication**:
   ```
   Dashboard:
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ 🔥 HyFire 2  │  │ 📖 Book   🔒 │  │ ⚔️ Epic      │
   │ Shared       │  │ Private       │  │ Shared       │
   │ 3/8 active   │  │ 1/1 active    │  │ 0/6 active   │
   └──────────────┘  └──────────────┘  └──────────────┘
   ```

   Private workspaces show lock icon, shared workspaces don't.

**Testing**:
- As web3dev1337: See all workspaces (HyFire, Book, Epic Survivors, Carm Crypto)
- Simulate NROCKX login: Only see HyFire, Epic Survivors (not Book or Carm Crypto)
- Try to access private workspace as teammate → blocked
- Workspace creation wizard respects access levels

**Success Criteria**:
✅ Access levels implemented
✅ Private workspaces hidden from teammates
✅ Shared workspaces visible to teammates
✅ Can't bypass access control
✅ UI clearly shows access level

**Note**: This phase is part of the full workflow; schedule it after the core process work if needed.

---

### Phase 7: Global Shortcuts & Quick Links (Week 7-8)

**Goal**: Persistent shortcuts + workspace-specific links

#### Implementation:

1. **Global Shortcuts** (always visible):
   ```javascript
   // ~/.orchestrator/config.json
   {
     "globalShortcuts": [
       {
         "label": "GitHub Profile",
         "url": "https://github.com/web3dev1337",
         "icon": "💻",
         "newTab": true
       },
       {
         "label": "Sentry",
         "url": "https://sentry.io/organizations/your-org",
         "icon": "📊",
         "newTab": true
       },
       {
         "label": "Claude Code Docs",
         "url": "https://docs.claude.com",
         "icon": "📚",
         "newTab": true
       }
     ]
   }
   ```

2. **Workspace-Specific Links**:
   ```javascript
   // ~/.orchestrator/workspaces/hyfire2.json
   {
     "quickLinks": [
       {
         "category": "Monitoring",
         "links": [
           { "label": "Sentry Dashboard", "url": "https://sentry.io/hyfire2" },
           { "label": "Game Analytics", "url": "https://..." }
         ]
       },
       {
         "category": "Documentation",
         "links": [
           { "label": "Hytopia Docs", "url": "https://docs.hytopia.com" },
           { "label": "Game Design Doc", "url": "https://..." }
         ]
       },
       {
         "category": "Actions",
         "links": [
           { "label": "Open Replay Folder", "action": "openReplayFolder" },
           { "label": "Performance Report", "action": "generatePerfReport" }
         ]
       }
     ]
   }
   ```

3. **UI Layout**:
   ```
   ┌─────────────────────────────────────┐
   │ 🏠 | 🔥 HyFire 2 ▼ | 🔔 | ⚙️      │  ← Header
   ├────┬────────────────────────────────┤
   │    │                                │
   │ S  │  [Terminal Grid]               │
   │ i  │                                │
   │ d  │                                │
   │ e  │                                │
   │ b  │                                │
   │ a  │                                │
   │ r  │                                │
   │    │                                │
   │ 🔗 │                                │  ← Quick Links section
   │    │                                │
   │ 💻 │                                │  ← Global shortcuts always visible
   │ 📊 │                                │
   │ 📚 │                                │
   └────┴────────────────────────────────┘
   ```

4. **Collapsible Sidebar Sections**:
   ```
   Sidebar:
   ┌──────────────────┐
   │ Worktrees   [−]  │ ← Collapsible
   │  1 - master      │
   │  2 - feature     │
   │  3 - bugfix      │
   ├──────────────────┤
   │ Quick Links [−]  │ ← Collapsible
   │  📊 Monitoring   │
   │    • Sentry      │
   │    • Analytics   │
   │  📚 Docs         │
   │    • Hytopia     │
   │    • Design Doc  │
   ├──────────────────┤
   │ Shortcuts   [−]  │ ← Always visible, collapsible
   │  💻 GitHub       │
   │  📊 Sentry       │
   │  📚 Claude Docs  │
   └──────────────────┘
   ```

**Testing**:
- Global shortcuts appear in all workspaces
- HyFire 2 shows Hytopia-specific links
- Book workspace shows writing-related links
- Links open in new tabs
- Action links trigger orchestrator functions

**Success Criteria**:
✅ Global shortcuts always visible
✅ Workspace links change when switching workspaces
✅ Links open correctly
✅ Action links execute functions
✅ Sidebar is not cluttered

---

### Phase 8: Notifications & Cross-Workspace Awareness (Week 8-9)

**Goal**: Manage notifications across workspaces

#### Challenge:
Currently in HyFire 2 workspace, working on work1. Epic Survivors workspace has an error in work3. How do I know?

#### Solution: Background Monitoring + Notification Center

1. **Background Workspace Monitoring**:
   ```javascript
   // server/workspaceManager.js
   class WorkspaceManager {
     constructor() {
       this.activeWorkspace = null;
       this.backgroundWorkspaces = new Map();  // Monitor inactive workspaces
     }

     async monitorBackgroundWorkspaces() {
       for (const [id, workspace] of this.workspaces) {
         if (id === this.activeWorkspace.id) continue;  // Skip active

         // Check if any sessions in this workspace are running
         const activeSessions = this.sessionManager.getSessionsForWorkspace(id);

         if (activeSessions.length > 0) {
           // This workspace has active background processes
           this.backgroundWorkspaces.set(id, {
             workspace,
             activeSessions,
             lastActivity: Date.now()
           });
         }
       }
     }

     handleBackgroundEvent(workspaceId, event) {
       // Event from inactive workspace (e.g., build complete, error)
       const notification = {
         workspace: workspaceId,
         type: event.type,
         message: event.message,
         timestamp: Date.now()
       };

       // Send to notification center
       this.notificationService.send(notification);
     }
   }
   ```

2. **Notification Center UI**:
   ```
   Click 🔔 icon:
   ┌───────────────────────────────────────┐
   │ Notifications                         │
   ├───────────────────────────────────────┤
   │ Active Workspace                      │
   │ 🔥 HyFire 2                           │
   │   ● work1-claude: PR ready #142       │
   │   ● work3-server: Build complete      │
   │                                       │
   │ Background Workspaces                 │
   │ ⚔️ Epic Survivors (2)                 │
   │   ● work3-server: Error - port 8082   │
   │   ● work1-claude: Waiting for input   │
   │   [Switch to Workspace] [Mute]        │
   │                                       │
   │ 📖 Book (Muted)                       │
   │   ○ work1-claude: Export complete     │
   │   [Unmute]                            │
   └───────────────────────────────────────┘
   ```

3. **Per-Workspace Notification Settings**:
   ```javascript
   // ~/.orchestrator/workspaces/hyfire2.json
   {
     "notifications": {
       "enabled": true,
       "background": true,  // Send notifications even when not active workspace
       "types": {
         "error": true,
         "build-complete": true,
         "pr-ready": true,
         "claude-waiting": false  // Don't notify when Claude is waiting
       },
       "priority": "high"  // Notifications always show, even when workspace is inactive
     }
   }
   ```

4. **Smart Notification Grouping**:
   ```
   Instead of:
     ● work1-claude: error
     ● work2-claude: error
     ● work3-claude: error

   Show:
     ● 3 Claude sessions have errors
       [View Details] [Switch to HyFire 2]
   ```

**Testing**:
- Working in HyFire 2 workspace
- Background: Epic Survivors has server error
- Notification appears: "⚔️ Epic Survivors: Server error"
- Click notification → switches to Epic Survivors workspace
- Can mute Epic Survivors notifications
- Muted workspace still shows notification count in dashboard

**Success Criteria**:
✅ Background workspaces monitored
✅ Cross-workspace notifications work
✅ Can mute specific workspaces
✅ Notification center shows all workspaces
✅ Click notification → switch to workspace

---

### Phase 9: One-Click Orchestrator Startup (Week 9)

**Goal**: Remove friction from starting orchestrator itself

#### Implementation:

1. **Startup Script** (`~/.local/bin/orchestrator`):
   ```bash
   #!/bin/bash
   # Claude Orchestrator Startup Script

   set -e

   ORCH_DIR="/home/ab/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev"
   PORT=3000
   CLIENT_PORT=2080

   GREEN='\033[0;32m'
   BLUE='\033[0;34m'
   NC='\033[0m'

   echo -e "${BLUE}🚀 Starting Claude Orchestrator...${NC}"

   # 1. Check if already running
   if lsof -i:$CLIENT_PORT >/dev/null 2>&1; then
     echo -e "${GREEN}✅ Orchestrator already running${NC}"
     xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &
     exit 0
   fi

   # 2. Navigate to orchestrator
   cd "$ORCH_DIR" || exit 1

   # 3. Optional: Pull latest (unless --no-update flag)
   if [[ "$1" != "--no-update" ]]; then
     echo -e "${BLUE}📥 Checking for updates...${NC}"
     git fetch origin main
     LOCAL=$(git rev-parse HEAD)
     REMOTE=$(git rev-parse origin/main)

     if [ "$LOCAL" != "$REMOTE" ]; then
       echo -e "${BLUE}⬇️ Pulling updates...${NC}"
       git pull origin main
       npm install  # Update dependencies if needed
     else
       echo -e "${GREEN}✅ Already up to date${NC}"
     fi
   fi

   # 4. Start services in background
   echo -e "${BLUE}🔧 Starting services...${NC}"
   npm run prod >/dev/null 2>&1 &
   ORCH_PID=$!

   # 5. Wait for client to be ready
   echo -e "${BLUE}⏳ Waiting for services...${NC}"
   TIMEOUT=30
   ELAPSED=0
   while ! lsof -i:$CLIENT_PORT >/dev/null 2>&1; do
     sleep 0.5
     ELAPSED=$((ELAPSED + 1))
     if [ $ELAPSED -gt $((TIMEOUT * 2)) ]; then
       echo -e "${RED}❌ Timeout waiting for services${NC}"
       kill $ORCH_PID 2>/dev/null
       exit 1
     fi
   done

   # 6. Open browser
   echo -e "${GREEN}✅ Opening orchestrator...${NC}"
   sleep 1
   xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &

   echo -e "${GREEN}🎉 Claude Orchestrator ready at http://localhost:$CLIENT_PORT${NC}"
   ```

2. **Desktop Shortcut** (`~/Desktop/Claude-Orchestrator.desktop`):
   ```ini
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=Claude Orchestrator
   Comment=Multi-workspace development environment
   Exec=/home/ab/.local/bin/orchestrator
   Icon=/home/ab/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev/client/icon.png
   Terminal=false
   Categories=Development;IDE;
   ```

3. **Installation Script** (`scripts/install-startup.sh`):
   ```bash
   #!/bin/bash
   # Install orchestrator startup shortcuts

   # 1. Copy startup script to bin
   cp scripts/orchestrator-startup.sh ~/.local/bin/orchestrator
   chmod +x ~/.local/bin/orchestrator

   # 2. Create desktop shortcut
   cat > ~/Desktop/Claude-Orchestrator.desktop << 'EOF'
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=Claude Orchestrator
   Comment=Multi-workspace development environment
   Exec=/home/ab/.local/bin/orchestrator
   Icon=/home/ab/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev/client/icon.png
   Terminal=false
   Categories=Development;IDE;
   EOF

   chmod +x ~/Desktop/Claude-Orchestrator.desktop

   # 3. Add to application menu
   mkdir -p ~/.local/share/applications
   cp ~/Desktop/Claude-Orchestrator.desktop ~/.local/share/applications/

   echo "✅ Orchestrator startup shortcuts installed"
   echo "💡 Run 'orchestrator' from terminal or click desktop icon"
   ```

**Testing**:
- Run `orchestrator` command → launches everything
- Click desktop shortcut → same result
- With orchestrator already running → just opens browser
- `orchestrator --no-update` → skips git pull
- Startup takes < 10 seconds

**Success Criteria**:
✅ Single command/click starts orchestrator
✅ Auto-opens browser when ready
✅ Handles "already running" gracefully
✅ Optional auto-update works
✅ Desktop shortcut functional

---

## 📊 Migration Strategy

### For Existing HyFire 2 Setup

1. **Run Migration Script**:
   ```bash
   cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev
   node scripts/migrate-to-workspaces.js
   ```

2. **What It Does**:
   - Creates `~/.orchestrator/` directory structure
   - Generates `config.json` from current `config.json`
   - Creates `workspaces/hyfire2.json` based on current setup:
     - Path: `/home/ab/HyFire2`
     - Worktrees: 8 (work1-8)
     - Type: `hytopia-game`
     - Launch settings: Current `serverLaunchSettings` from localStorage
   - Creates `templates/launch-settings/hytopia-game.json` from current modal

3. **Result**:
   - Orchestrator still works exactly as before
   - But now it's workspace-aware
   - Can add more workspaces without breaking HyFire 2

### Backward Compatibility

- **Old config.json**: Automatically migrated, old file kept as `.backup`
- **localStorage**: `server-launch-settings` still used, but also saved to workspace config
- **User settings**: `user-settings.json` unchanged
- **Session states**: Still stored in Claude Code's native location

---

## 🎨 UI/UX Considerations

### Dashboard vs Direct Load

**Option A: Always Show Dashboard**
- Pros: Clear workspace overview, easy to switch
- Cons: One extra click to get to work

**Option B: Remember Last Workspace**
- Pros: Faster to resume work
- Cons: Less discoverable, harder to switch

**Recommendation**: Configurable (default: dashboard)

### Workspace Transition Animation

```
1. Fade out current terminal grid
2. Show workspace icon + name overlay (0.5s)
3. Fade in new terminal grid
4. Total: ~1 second
```

### Notification Priorities

| Priority | Behavior |
|----------|----------|
| **Critical** | Always show, even for background workspaces (errors, build failures) |
| **High** | Show for active workspace, badge for background |
| **Normal** | Show for active workspace only |
| **Low** | No notification, just log |

---

## 🔐 Security & Access

### Multi-User Scenarios

1. **Single Machine, Single User** (Current):
   - No authentication needed
   - All workspaces accessible

2. **Single Machine, Multiple Users** (Future):
   - Optional: Add login screen
   - Filter workspaces by user
   - Per-user settings

3. **Remote Access** (Future):
   - Run orchestrator on server
   - Access via HTTPS
   - Require authentication
   - WebSocket over TLS

---

## 🚀 Rollout Plan

### Week 1-2: Foundation
- Release: Internal alpha
- Features: Multi-workspace backend, migration script
- Users: You only

### Week 3-4: UI
- Release: Internal alpha 2
- Features: Dashboard, workspace switching
- Users: You only

### Week 5-6: Templates & Wizard
- Release: Internal beta
- Features: Launch templates, creation wizard
- Users: You + possibly NROCKX (if sharing)

### Week 7-9: Polish
- Release: Internal RC
- Features: Notifications, shortcuts, startup script
- Users: Broader testing

### Week 10: Launch
- Release: v2.0.0
- Features: Complete workspace management
- Users: Public (if open-sourcing)

---

## 📈 Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| **Startup Time** | 2 minutes (manual) | 10 seconds | 12x faster |
| **Workspace Switch** | N/A (only HyFire) | 5 seconds | < 5s |
| **New Workspace Setup** | N/A | 2 minutes (wizard) | < 5 min |
| **Context Switching Friction** | High (mental load) | Low (visual clarity) | Effortless |
| **Multi-Project Support** | 1 project | Unlimited | 5+ typical |

---

## 🛠️ Technical Debt & Cleanup

### Current Issues to Address

1. **Hardcoded Paths**:
   - `/home/ab/HyFire2` → Use workspace config
   - Port calculation: `8080 + worktreeNum` → Use workspace config

2. **Launch Settings Modal**:
   - Massive HTML string → Template-driven rendering
   - HyFire-specific → Generic with templates

3. **Worktree Assumptions**:
   - Always 8 worktrees → Dynamic count
   - Pre-created → On-demand creation

4. **Config Split**:
   - Client localStorage + server JSON → Unified in workspace config
   - Global vs per-terminal vs per-worktree → Clear hierarchy

---

## 🎯 Next Steps

1. **Review & Prioritize**:
   - Confirm phases match your priorities
   - Adjust timeline if needed
   - Identify must-have vs nice-to-have features

2. **Set Up Development Environment**:
   - Create `feature/multi-workspace` branch
   - Set up `.orchestrator/` directory structure
   - Create migration script

3. **Start Phase 1**:
   - Implement `WorkspaceManager`
   - Create migration script
   - Test backward compatibility

4. **Iterate**:
   - Build → Test → Get Feedback → Refine
   - Ship working increments
   - Don't wait for perfection

---

## 📝 Open Questions

1. **Worktree Naming**: Stick with `work{n}` for all projects, or allow customization (e.g., `hyfire-work1`, `epic-work1`)?
2. **Shared Settings**: Should some launch settings be shareable across workspaces (e.g., memory limit)?
3. **Model Selection**: How important is per-workspace Claude model configuration?
4. **Cloud Sync**: Interest in syncing workspace configs across machines?
5. **Team Collaboration**: Priority level for shared workspaces (NROCKX use case)?
6. **Workspace Export/Import**: Useful for sharing configurations?

---

**Document Version**: 2.0 (Revised)
**Date**: 2025-09-27
**Status**: Ready for Implementation
