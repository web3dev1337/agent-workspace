# Agent Orchestrator (repo: `claude-orchestrator`)

A multi-workspace development environment for AI coding agent sessions (Claude Code, Codex) with dynamic repository management, mixed-repo workspaces, and one-click startup.

> Note: the repository is still named `claude-orchestrator` for historical reasons. The UI/product name is **Agent Orchestrator**.

## 🚀 Features

### 🎯 **Multi-Workspace Management**
- **Unlimited Workspaces**: Switch between HyFire, Epic Survivors, websites, writing projects
- **Dashboard UI**: Visual workspace selection with activity indicators
- **Dynamic Configuration**: 1-16 terminal pairs per workspace
- **Project Type Awareness**: Auto-detects Hytopia, MonoGame, website, writing projects

### 🧠 **Process Layer (Tiers + Queue + Risk + Prompts + Dependencies)**
- **Workflow Modes**: Focus (T1–T2) / Review (all; opens Queue) / Background (T3–T4)
- **Tier Tagging**: Per-agent tier selector (`None/T1–T4`) + tier filters
- **Review Inbox (“📥 Queue”)**: Unified PR/worktree/session list with Next/Prev navigation
- **Focus Helpers**: `T2 Auto/Always` + `Swap T2` auto-switch while Tier 1 is busy
- **Risk Metadata**: Base project risk + per-task change risk + `pFailFirstPass` + `verifyMinutes`
- **Prompt Artifacts**: Store massive prompts locally (private by default) with optional Trello embed
- **Dependencies**:
  - Trello-backed: checklist convention named `Dependencies`
  - Orchestrator-native: stored in local task records for non-Trello tasks
- **Review Automation (v1)**:
  - Queue: “Auto Reviewer” for Tier 3 PRs + manual “Reviewer” and “Fixer” actions
  - Dependency graph modal + “pick from queue” dependency linking

### 🛠️ **Mixed-Repository Workspaces**
- **Revolutionary Feature**: Combine terminals from multiple repositories in one workspace
- **Example**: 2 HyFire + 4 Epic Survivors + 1 Website terminals together
- **Per-Terminal Buttons**: Each terminal shows repo-appropriate controls
- **Conflict Detection**: Smart indicators for worktree usage across workspaces

### ⚡ **Dynamic Worktree Management**
- **Auto-Creation**: Creates git worktrees on-demand when switching workspaces
- **On-Demand Expansion**: Add more worktrees via "+ Add Worktree" button
- **Deep Repository Scanning**: Finds all projects (HyFire2, Epic Survivors, scripts, etc.)
- **Smart Conflict Detection**: Shows ⚠️ In use vs ✅ Available status

### 🎨 **Advanced UI Components**
- **Workspace Creation Wizard**: 3-step guided setup with auto-type detection
- **Enhanced Sidebar**: Quick links, worktree management, global shortcuts
- **Cross-Workspace Notifications**: Background monitoring with muting controls
- **Launch Settings Templates**: Project-type specific configuration UIs

### 🔧 **Zero-Friction Workflow**
- **One-Click Startup**: `orchestrator` command launches everything
- **Desktop Integration**: Click shortcut → auto-opens browser
- **Auto-Update**: Git pull on startup with dependency management
- **Smart Detection**: Opens browser if already running

## 📊 Quick Start

### Installation
```bash
# Navigate to orchestrator directory
cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev

# Run migration to set up workspace system
node scripts/migrate-to-workspaces.js

# Install one-click startup shortcuts
bash scripts/install-startup.sh
```

### Launch Orchestrator
```bash
# Command line (after install)
orchestrator

# Or desktop shortcut
# Click "Claude Orchestrator" icon

# Or manual startup
npm run dev:all
```

### Process docs (resume-safe)
- `PLANS/2026-01-25/WORKFLOW_TIER_RISK_PROMPTS.md` (what’s shipped vs missing)
- `PLANS/2026-01-25/BRAIN_DUMP_IMPLEMENTATION_PLAN.md` (brain dump → PR-sized plan)
- `PLANS/2026-01-25/DATA_MODEL.md` (where the data lives)

### Tier persistence (refresh-safe)
Tier tagging (T1–T4) persists across page refreshes and server restarts because it is stored in task records:
- `~/.orchestrator/task-records.json` (`session:<id>`, `pr:owner/repo#123`, `worktree:/path`)

### Create Your First Custom Workspace
1. **Access Dashboard**: http://localhost:4000 (dev) or http://localhost:2080 (prod)
2. **Click "Create New"** → Opens workspace wizard
3. **Select Repository**: Choose from categorized list (Hytopia Games, MonoGame Games, Writing, etc.)
4. **Configure**: Set name, terminal count, access level
5. **Review & Create**: Workspace ready immediately

### Add Mixed-Repo Terminals
1. **In any workspace** → Click **"+ Add Worktree"** in sidebar
2. **Browse Categories**: Hytopia Games, MonoGame Games, Writing, Tools
3. **Select Worktree**: See ⚠️ In use vs ✅ Available status for each work1-8
4. **Add to Workspace**: Creates mixed-repo workspace automatically

## 🏗️ Architecture

### Backend Services
- **WorkspaceManager**: Core workspace CRUD with JSON config persistence
- **SessionManager**: Dynamic session management for single/mixed-repo workspaces
- **WorktreeHelper**: Automated git worktree creation with conflict resolution
- **Deep Scanner**: Recursive project discovery with path-based type detection

### Frontend Components
- **Dashboard**: Visual workspace cards with activity and stats
- **WorkspaceSwitcher**: Header dropdown for instant workspace switching
- **WorkspaceWizard**: Guided workspace creation with repository categorization
- **Advanced Add Worktree**: Multi-repo selection with conflict detection

### Configuration
```
~/.orchestrator/
├── config.json                    # Master configuration
├── workspaces/                    # Workspace definitions
│   ├── hyfire2.json              # Single-repo workspace
│   ├── epic-survivors.json       # Single-repo workspace
│   └── custom-dev.json           # Mixed-repo workspace
├── templates/                     # Project type templates
└── session-states/               # Persistent session states
```

## 🎯 Workspace Types

### Single-Repository Workspaces
Traditional approach where all terminals come from one repository:
- **HyFire 2**: 8 terminal pairs from HyFire repository
- **Epic Survivors**: 1-8 terminal pairs from Epic Survivors repository
- **Website**: 1-4 terminal pairs from website repository

### Mixed-Repository Workspaces
Revolutionary approach combining terminals from multiple repositories:
- **Custom Dev**: 2 HyFire + 4 Epic Survivors + 1 Website terminals
- **Game Focus**: 4 HyFire + 2 MonoGame + 2 Tools terminals
- **Any Combination**: Complete flexibility in terminal composition

## 🔧 Development

### Project Structure
```
claude-orchestrator-dev/
├── server/                      # Backend services
│   ├── workspaceManager.js     # Core workspace management
│   ├── sessionManager.js       # Session lifecycle with mixed-repo support
│   ├── worktreeHelper.js       # Dynamic worktree creation
│   └── workspaceSchemas.js     # Single/mixed workspace schemas
├── client/                      # Frontend components
│   ├── dashboard.js            # Workspace dashboard UI
│   ├── workspace-switcher.js   # Header dropdown switcher
│   ├── workspace-wizard.js     # Workspace creation wizard
│   └── app.js                  # Main orchestrator application
├── templates/                   # Project type templates
│   └── launch-settings/        # Launch configuration templates
├── scripts/                     # Automation scripts
│   ├── migrate-to-workspaces.js # Migration from old config
│   ├── orchestrator-startup.sh  # One-click startup
│   └── install-startup.sh       # Desktop shortcut installer
└── ~/.orchestrator/            # User configuration directory
```

### Available Scripts
```bash
npm run dev:all          # Start all services (server + client + tauri)
npm run dev              # Development mode (ports 4000/2081)
npm run prod             # Production mode (ports 3000/2080)
npm run tauri:dev        # Native app development
npm run tauri:build      # Build native app for distribution
```

## 📈 Capabilities

### Repository Discovery
- **Deep Scanning**: Finds individual projects in nested folder structures
- **Auto-Type Detection**: Determines project type from folder path
- **Categories**: Hytopia Games, MonoGame Games, Websites, Writing, Tools
- **Project Examples**: HyFire2, Epic Survivors, cb-fry-scripts, 2d-test, etc.

### Workspace Management
- **Unlimited Workspaces**: Create as many as needed
- **Dynamic Terminal Counts**: 1-16 pairs per workspace
- **Clean Isolation**: Perfect separation between workspace sessions
- **Instant Switching**: < 5 second workspace transitions

### Advanced Features
- **Worktree Conflict Detection**: Visual status indicators (⚠️ In use / ✅ Available)
- **Mixed-Repo Composition**: Any combination of repositories in one workspace
- **3-Layer Button System**: Game → Framework → Project specific controls
- **Background Monitoring**: Cross-workspace notifications with muting

## 🚀 Getting Started

1. **Installation**: `bash scripts/install-startup.sh`
2. **Launch**: `orchestrator` (or click desktop shortcut)
3. **Create Workspace**: Dashboard → Create New → Select repository
4. **Add Mixed Terminals**: "+ Add Worktree" → Browse repositories
5. **Enjoy**: Complete development environment ready!

---

**Transforms Claude Orchestrator from single-project tool to unlimited multi-workspace development environment with mixed-repository support and zero-friction workflows.**
