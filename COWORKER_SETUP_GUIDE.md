# 🚀 Claude Orchestrator - Co-Worker Setup Guide

**Last Updated**: 2025-09-30
**Target Audience**: New team members setting up Claude Orchestrator for the first time

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Folder Structure Convention](#folder-structure-convention)
3. [Git Repository Hierarchy](#git-repository-hierarchy)
4. [Initial System Setup](#initial-system-setup)
5. [Orchestrator Installation](#orchestrator-installation)
6. [Creating Your First Workspace](#creating-your-first-workspace)
7. [Understanding Worktrees](#understanding-worktrees)
8. [Workspace Types](#workspace-types)
9. [Mixed-Repository Workspaces](#mixed-repository-workspaces)
10. [Daily Workflow](#daily-workflow)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

Claude Orchestrator is a revolutionary multi-workspace system for managing unlimited Claude Code sessions across different projects. It uses:

- **Git worktrees** for parallel development
- **Dynamic terminal management** (1-16 terminal pairs per workspace)
- **Mixed-repository support** (multiple repos in one workspace)
- **Zero-friction startup** (one command launches everything)

---

## 📁 Folder Structure Convention

This is the **standard folder hierarchy** used across all projects. Following this convention enables:
- ✅ Automatic project detection
- ✅ Workspace wizard auto-configuration
- ✅ Clean separation of concerns
- ✅ Easy navigation and consistency

### Master Structure

```
~/GitHub/
├── docs/                           # Documentation & reference projects
│   ├── claude-code-docs/
│   │   └── master/                 # Main branch git worktree
│   ├── refactoring-examples/
│   │   └── master/
│   └── [other-docs]/
│       └── master/
│
├── games/                          # Game development projects
│   ├── hytopia/                    # Hytopia voxel games
│   │   └── games/                  # Individual game projects
│   │       ├── HyFire2/
│   │       │   ├── master/         # Main branch worktree (ALWAYS exists)
│   │       │   ├── work1/          # Development worktree (auto-created)
│   │       │   ├── work2/          # Development worktree (auto-created)
│   │       │   ├── work3/          # ... up to work8
│   │       │   └── [other branches]
│   │       ├── astro-breaker/
│   │       │   └── master/
│   │       └── hytopia-2d-game-test/
│   │           └── master/
│   │
│   ├── monogame/                   # MonoGame C# projects
│   │   ├── epic-survivors/
│   │   │   ├── master/
│   │   │   └── work1/
│   │   ├── monotest/
│   │   │   └── master/
│   │   └── monogame-project-analyzer/
│   │       └── master/
│   │
│   ├── minecraft/                  # Minecraft mods/projects
│   │   ├── OpenPixelmon/
│   │   │   └── master/
│   │   └── minecraft-block-shapes/
│   │       └── master/
│   │
│   ├── rust/                       # Rust game projects
│   │   └── stardew-mmo-engine/
│   │       └── master/
│   │
│   └── web/                        # Browser-based games
│       ├── vampire-survivors-clone/
│       │   └── master/
│       ├── rougelike-dungeon-crawler/
│       │   └── master/
│       └── 2d-pixel-house-builder/
│           └── master/
│
├── tools/                          # Development tools & utilities
│   ├── automation/                 # Automation scripts
│   │   ├── claude-orchestrator/
│   │   │   ├── master/             # Production instance
│   │   │   └── claude-orchestrator-dev/  # Development instance (NOT a worktree!)
│   │   ├── auto-trello/
│   │   │   └── master/
│   │   └── youtube-transcript-download/
│   │       └── master/
│   │
│   └── mcp/                        # Model Context Protocol servers
│       ├── mcp-server-trello/
│       │   └── master/
│       ├── jsfxr-mcp/
│       │   └── master/
│       └── mcp-server/
│           └── master/
│
├── web/                            # Web applications & sites
│   └── calm-crypto-prototype/
│       └── master/
│
├── writing/                        # Writing projects
│   ├── books/
│   │   └── ai-book-writing-framework/
│   │       ├── master/
│   │       ├── work1/
│   │       └── work2/
│   │
│   └── screenplays/
│       └── cb-fry-miniseries/
│           └── master/
│
└── website/                        # Personal/company websites
```

---

## 🔄 Git Repository Hierarchy

### Critical Understanding: Where Git Repos Live

**❌ WRONG**: Git repo at project level
```
~/GitHub/games/hytopia/games/HyFire2/.git  ❌ NO!
```

**✅ CORRECT**: Git repo inside `master/` folder
```
~/GitHub/games/hytopia/games/HyFire2/master/.git  ✅ YES!
```

### The Pattern: PROJECT_ROOT/WORKTREE_NAME/

Every project follows this structure:

```
[PROJECT_ROOT]/
├── master/              # The ACTUAL git repository
│   ├── .git/           # Git metadata lives HERE
│   ├── package.json    # Source code lives HERE
│   └── [all files]
│
├── work1/              # Git worktree (created by orchestrator)
│   ├── .git           # Symlink/worktree ref to master/.git
│   └── [branch files]
│
├── work2/              # Another worktree
└── work{n}/            # Up to work8 (configurable)
```

### Why This Structure?

1. **Clean separation**: Project metadata vs actual code
2. **Worktree compatibility**: `git worktree add ../work1` works cleanly
3. **Visual clarity**: Easy to see what's a worktree vs main repo
4. **Orchestrator expects it**: The system auto-creates worktrees in this pattern

### Git Commands in Context

When working in this structure:

```bash
# Clone a NEW project (use worktree pattern immediately)
cd ~/GitHub/games/monogame
mkdir my-new-game
cd my-new-game
git clone https://github.com/you/my-new-game master

# Create first worktree
cd master
git worktree add ../work1 -b feature/my-feature

# Orchestrator will auto-create work2-8 as needed
```

---

## 🛠️ Initial System Setup

### 1. Prerequisites

```bash
# Install Node.js (v18+ recommended)
# Install Git (v2.30+)

# Verify installations
node --version  # Should be v18+
git --version   # Should be v2.30+
```

### 2. Create Base Folder Structure

```bash
# Create the GitHub root
mkdir -p ~/GitHub

# Create category folders
mkdir -p ~/GitHub/games/{hytopia/games,monogame,minecraft,rust,web}
mkdir -p ~/GitHub/tools/{automation,mcp}
mkdir -p ~/GitHub/web
mkdir -p ~/GitHub/writing/{books,screenplays}
mkdir -p ~/GitHub/docs
mkdir -p ~/GitHub/website
```

### 3. Clone Your Projects (Following the Convention)

**Example: Cloning a Hytopia game project**

```bash
# Navigate to the project category
cd ~/GitHub/games/hytopia/games

# Create project folder
mkdir HyFire2

# Clone INTO the master folder
cd HyFire2
git clone https://github.com/web3dev1337/hyfire2 master

# Verify structure
ls -la  # Should show master/ folder
ls -la master/.git  # Git repo is INSIDE master/
```

**Example: Cloning a MonoGame project**

```bash
cd ~/GitHub/games/monogame
mkdir epic-survivors
cd epic-survivors
git clone https://github.com/yourorg/epic-survivors master
```

**Example: Cloning a writing project**

```bash
cd ~/GitHub/writing/books
mkdir ai-book-writing-framework
cd ai-book-writing-framework
git clone https://github.com/you/book-framework master
```

---

## 🎛️ Orchestrator Installation

### 1. Install the Orchestrator

```bash
cd ~/GitHub/tools/automation
mkdir claude-orchestrator
cd claude-orchestrator

# Clone the orchestrator into master/
git clone https://github.com/web3dev1337/claude-orchestrator master

# Install dependencies
cd master
npm install
```

### 2. Install System-Wide Shortcuts

```bash
# Run the installation script
bash scripts/install-startup.sh

# This creates:
# - ~/bin/orchestrator (command-line shortcut)
# - ~/.local/share/applications/claude-orchestrator.desktop (desktop icon)
```

### 3. Configure Environment (Optional)

Create `master/.env` if you need custom ports:

```bash
PORT=3000              # Server port
CLIENT_PORT=2080       # Client UI port
TAURI_DEV_PORT=1420    # Native app port
LOG_LEVEL=info         # Logging level
```

### 4. Launch the Orchestrator

```bash
# Command line (after install-startup.sh)
orchestrator

# OR manually
cd ~/GitHub/tools/automation/claude-orchestrator/master
npm run dev:all

# Access at: http://localhost:2080
```

---

## 🎨 Creating Your First Workspace

### Option 1: Using the Wizard (Recommended)

1. **Launch orchestrator** and open http://localhost:2080
2. **Click "Create New Workspace"** in the dashboard
3. **Select workspace type** (e.g., "Hytopia Game", "MonoGame", "Writing")
4. **Choose repository** from auto-detected list
5. **Configure settings**:
   - Number of terminal pairs (1-16)
   - Auto-create worktrees (recommended: YES)
   - Default launch settings
6. **Review and create**

The wizard will:
- ✅ Detect your project type automatically
- ✅ Set up appropriate configuration
- ✅ Create workspace JSON file
- ✅ Ready to switch immediately

### Option 2: Manual JSON Creation

Create `~/.orchestrator/workspaces/my-project.json`:

```json
{
  "id": "my-project",
  "name": "My Project",
  "type": "hytopia-game",
  "icon": "🎮",
  "description": "My awesome game project",
  "access": "private",
  "repository": {
    "path": "/home/youruser/GitHub/games/hytopia/games/my-project",
    "masterBranch": "master",
    "remote": "https://github.com/you/my-project"
  },
  "worktrees": {
    "enabled": true,
    "count": 8,
    "namingPattern": "work{n}",
    "autoCreate": true
  },
  "terminals": {
    "pairs": 4,
    "defaultVisible": [1, 2],
    "layout": "dynamic"
  },
  "launchSettings": {
    "type": "hytopia-game",
    "defaults": {
      "envVars": "NODE_ENV=development",
      "nodeOptions": "--max-old-space-size=4096",
      "gameArgs": "--mode=casual"
    },
    "perWorktree": {}
  },
  "shortcuts": [],
  "quickLinks": [],
  "theme": {
    "primaryColor": "#007acc",
    "icon": "🎮"
  },
  "notifications": {
    "enabled": true,
    "background": true,
    "types": {},
    "priority": "normal"
  }
}
```

---

## 🌳 Understanding Worktrees

### What Are Worktrees?

Git worktrees allow you to check out **multiple branches simultaneously** in different folders. This is PERFECT for parallel development.

### How Orchestrator Uses Worktrees

```
HyFire2/
├── master/          # Main branch (your "source of truth")
│   └── .git/       # The actual git repository
│
├── work1/          # Worktree: feature branch 1
├── work2/          # Worktree: feature branch 2
├── work3/          # Worktree: feature branch 3
└── work{n}/        # Up to work8 by default
```

### Terminal Pairs

Each workspace has **terminal pairs** (Claude + Server):

- **Claude terminal**: Where Claude Code runs
- **Server terminal**: Where you run dev servers, build scripts, etc.

**Example**: 4 terminal pairs = 4 Claude sessions + 4 server terminals

### Auto-Creation Flow

When you switch to a workspace:

1. Orchestrator checks for `work1/`, `work2/`, etc.
2. If missing, runs `git worktree add ../work1 master`
3. Creates terminal pair for each worktree
4. You're ready to code immediately!

### Manual Worktree Management

```bash
# Inside master/ directory
cd ~/GitHub/games/hytopia/games/HyFire2/master

# Create a worktree manually
git worktree add ../work1 -b feature/my-feature

# List worktrees
git worktree list

# Remove a worktree
git worktree remove ../work1
```

---

## 🏷️ Workspace Types

The orchestrator supports 10+ workspace types, each with tailored settings:

### 1. **hytopia-game**
- **Icon**: 🎮
- **Use Case**: Hytopia voxel games
- **Terminal Pairs**: 1-8 (default: 4)
- **Launch Settings**: Game modes, server config, bot settings
- **Example Projects**: HyFire2, Astro Breaker

### 2. **monogame-game**
- **Icon**: 🎯
- **Use Case**: MonoGame C# games
- **Terminal Pairs**: 1-4 (default: 2)
- **Launch Settings**: Build config, platform target, debug options
- **Example Projects**: Epic Survivors

### 3. **writing**
- **Icon**: 📖
- **Use Case**: Books, articles, screenplays
- **Terminal Pairs**: 1-2 (default: 1)
- **Launch Settings**: Export formats, word count goals
- **Example Projects**: AI Book Writing Framework

### 4. **website**
- **Icon**: 🌐
- **Use Case**: Web applications
- **Terminal Pairs**: 2-4 (default: 2)
- **Launch Settings**: Dev server, build commands, deploy settings

### 5. **tool**
- **Icon**: 🔧
- **Use Case**: CLI tools, utilities, automation scripts
- **Terminal Pairs**: 1-2 (default: 1)

### 6. **mcp-server**
- **Icon**: 🔌
- **Use Case**: Model Context Protocol servers
- **Terminal Pairs**: 1-2 (default: 1)

### 7. **documentation**
- **Icon**: 📚
- **Use Case**: Documentation sites, wikis
- **Terminal Pairs**: 1-2 (default: 1)

### 8. **minecraft-mod**
- **Icon**: ⛏️
- **Use Case**: Minecraft mods/plugins
- **Terminal Pairs**: 2-4 (default: 2)

### 9. **rust-game**
- **Icon**: 🦀
- **Use Case**: Rust game projects
- **Terminal Pairs**: 2-4 (default: 2)

### 10. **generic**
- **Icon**: 📁
- **Use Case**: Anything else
- **Terminal Pairs**: Configurable

---

## 🔀 Mixed-Repository Workspaces

**Advanced Feature**: One workspace managing MULTIPLE repositories simultaneously.

### Use Case

You're working on a game ecosystem with:
- Main game repo (HyFire2)
- 2D companion game (hytopia-2d-game-test)
- Shared library repo (epic-survivors)

Instead of switching workspaces constantly, create ONE mixed workspace.

### Example Configuration

`~/.orchestrator/workspaces/mixed-terminals.json`:

```json
{
  "id": "mixed-terminals",
  "name": "Game Ecosystem",
  "workspaceType": "mixed-repo",
  "terminals": [
    {
      "id": "hyfire2-work1-claude",
      "repository": {
        "name": "HyFire2",
        "path": "/home/ab/GitHub/games/hytopia/games/HyFire2",
        "masterBranch": "master"
      },
      "worktree": "work1",
      "terminalType": "claude",
      "visible": true
    },
    {
      "id": "hyfire2-work1-server",
      "repository": {
        "name": "HyFire2",
        "path": "/home/ab/GitHub/games/hytopia/games/HyFire2",
        "masterBranch": "master"
      },
      "worktree": "work1",
      "terminalType": "server",
      "visible": true
    },
    {
      "id": "2d-game-work1-claude",
      "repository": {
        "name": "hytopia-2d-game-test",
        "path": "/home/ab/GitHub/games/hytopia/games/hytopia-2d-game-test",
        "masterBranch": "master"
      },
      "worktree": "work1",
      "terminalType": "claude",
      "visible": true
    },
    {
      "id": "2d-game-work1-server",
      "repository": {
        "name": "hytopia-2d-game-test",
        "path": "/home/ab/GitHub/games/hytopia/games/hytopia-2d-game-test",
        "masterBranch": "master"
      },
      "worktree": "work1",
      "terminalType": "server",
      "visible": true
    }
  ]
}
```

### Terminal Naming Convention (Mixed-Repo)

**Pattern**: `{repo-name}-{worktree}-{type}`

Examples:
- `hyfire2-work1-claude`
- `hyfire2-work1-server`
- `epic-survivors-work1-claude`
- `hytopia-2d-game-test-work2-server`

This prevents ID conflicts between repositories.

---

## 💼 Daily Workflow

### Morning Startup

```bash
# Start orchestrator
orchestrator

# Browser opens automatically at http://localhost:2080
# Dashboard shows all your workspaces
```

### Switching Workspaces

**Option 1: Dashboard**
- Click workspace card to switch

**Option 2: Header Dropdown**
- Click current workspace name → select new workspace

**Option 3: API/Console**
```javascript
// In browser console
window.orchestrator.switchToWorkspace('hyfire2');
```

### Working Across Worktrees

1. **Switch to workspace** (e.g., "HyFire 2")
2. **8 terminal pairs appear** (if configured for 8)
3. **Each pair** = 1 worktree:
   - Top terminal: Claude Code session
   - Bottom terminal: Dev server / build commands

### Example Workflow: Multi-Feature Development

**Scenario**: You need to work on 3 features simultaneously

1. **Switch to project workspace**
2. **Terminal Pair 1** (work1):
   - Claude: Implements feature A
   - Server: Runs game with feature A
3. **Terminal Pair 2** (work2):
   - Claude: Implements feature B
   - Server: Runs game with feature B
4. **Terminal Pair 3** (work3):
   - Claude: Fixes bug C
   - Server: Runs tests

All three are **independent git branches** in parallel worktrees!

### End of Day

The orchestrator keeps sessions alive. You can:
- Close browser (sessions persist)
- Stop orchestrator: `Ctrl+C` in server terminal
- Restart anytime: `orchestrator`

---

## 🔧 Troubleshooting

### Issue: "node-pty segmentation fault"

**Symptom**: Server crashes with segfault

**Fix**:
```bash
cd ~/GitHub/tools/automation/claude-orchestrator/master
npm rebuild node-pty
```

### Issue: "Worktree creation failed"

**Symptom**: "fatal: '../work1' already exists"

**Fix**:
```bash
# Check existing worktrees
cd ~/GitHub/[path]/master
git worktree list

# Remove orphaned worktree
git worktree remove ../work1 --force

# Or manually delete
rm -rf ../work1
```

### Issue: "Port already in use"

**Symptom**: `Error: listen EADDRINUSE :::3000`

**Fix**:
```bash
# Find process using port
lsof -i :3000

# Kill it
kill -9 [PID]

# Or use different port in .env
echo "PORT=3001" >> .env
```

### Issue: "Workspace not detected by wizard"

**Symptom**: Your project doesn't appear in repo scan

**Fix**: Ensure your folder structure follows the convention:
```bash
# Should be:
~/GitHub/[category]/[subcategory]/[project]/master/.git

# NOT:
~/GitHub/[project]/.git  ❌
```

### Issue: "Claude Code not starting in terminal"

**Symptom**: Terminal opens but Claude doesn't launch

**Fix**:
```bash
# Check Claude Code is installed
which claude

# Install if missing
npm install -g @anthropic-ai/claude-code

# Or use system package manager
```

### Issue: "Dashboard shows 0 workspaces"

**Symptom**: Empty dashboard after creation

**Fix**:
```bash
# Check workspace files exist
ls -la ~/.orchestrator/workspaces/

# Verify JSON is valid
cat ~/.orchestrator/workspaces/my-project.json | jq .

# Restart orchestrator
```

---

## 📚 Additional Resources

### Key Documentation Files

- **CODEBASE_DOCUMENTATION.md**: Complete system architecture
- **COMPLETE_IMPLEMENTATION.md**: Feature implementation details
- **CLAUDE.md**: Development guidelines for the orchestrator itself
- **PR_SUMMARY.md**: Technical PR reference

### Workspace Templates

Located in `master/templates/launch-settings/`:
- `hytopia-game.json` - Hytopia game settings
- `monogame-game.json` - MonoGame settings
- `website.json` - Web app settings
- `writing.json` - Writing project settings

### Scripts

Located in `master/scripts/`:
- `install-startup.sh` - Install system shortcuts
- `orchestrator-startup.sh` - Main startup script
- `migrate-to-workspaces.js` - Legacy migration

---

## 🎯 Quick Start Checklist

For a new co-worker:

- [ ] Install Node.js v18+
- [ ] Install Git v2.30+
- [ ] Create folder structure: `~/GitHub/{games,tools,web,writing,docs}/...`
- [ ] Clone projects into `master/` folders
- [ ] Clone orchestrator to `~/GitHub/tools/automation/claude-orchestrator/`
- [ ] Run `npm install` in orchestrator
- [ ] Run `bash scripts/install-startup.sh`
- [ ] Launch orchestrator: `orchestrator` or `npm run dev:all`
- [ ] Create first workspace using wizard
- [ ] Switch to workspace and verify worktrees auto-create
- [ ] Start coding!

---

## 🤝 Getting Help

If you run into issues:

1. **Check logs**: `~/.orchestrator/logs/combined.log`
2. **Review this guide**: Especially folder structure section
3. **Check Git worktrees**: `git worktree list` in master/
4. **Restart orchestrator**: Often fixes transient issues
5. **Ask the team**: Share your `~/.orchestrator/workspaces/[project].json`

---

## 🎉 Welcome to the Team!

You're now set up with one of the most powerful development environments for parallel Claude Code workflows. Happy coding! 🚀