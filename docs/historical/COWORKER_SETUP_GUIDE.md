# 🚀 Claude Orchestrator - Co-Worker Setup Guide

**Last Updated**: 2025-09-30
**Target Audience**: New team members setting up Claude Orchestrator for the first time

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [AI Agent Configuration System](#ai-agent-configuration-system)
3. [Folder Structure Convention](#folder-structure-convention)
4. [Git Repository Hierarchy](#git-repository-hierarchy)
5. [Initial System Setup](#initial-system-setup)
6. [Orchestrator Installation](#orchestrator-installation)
7. [Creating Your First Workspace](#creating-your-first-workspace)
8. [Understanding Worktrees](#understanding-worktrees)
9. [Workspace Types](#workspace-types)
10. [Mixed-Repository Workspaces](#mixed-repository-workspaces)
11. [Daily Workflow](#daily-workflow)
12. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

Claude Orchestrator is a revolutionary multi-workspace system for managing unlimited Claude Code sessions across different projects. It uses:

- **Git worktrees** for parallel development
- **Dynamic terminal management** (1-16 terminal pairs per workspace)
- **Mixed-repository support** (multiple repos in one workspace)
- **Zero-friction startup** (one command launches everything)

---

## 🤖 AI Agent Configuration System

### Overview

This system manages AI agent instructions (CLAUDE.md files) across all projects using a **centralized repository + symlink** approach.

### Why This System Exists

**Problem**: Every project needs Claude instructions, but:
- ❌ Copying CLAUDE.md to 50+ projects is unmaintainable
- ❌ Updates need to be synced across all projects manually
- ❌ Different projects (Hytopia games, MonoGame, websites) need different guidelines

**Solution**: Central repos with automatic symlinking
- ✅ One source of truth per project type
- ✅ Updates propagate automatically via git pull + sync
- ✅ Category-level AND project-level configurations
- ✅ Works with any AI tool (Claude, Cursor, Aider)

### Architecture

```
~/.claude/                              # Central configuration hub
├── CLAUDE.md                           # Global Claude instructions
├── shared-repos.yml                    # Registry of agent config repos
├── installed/                          # Cloned agent repos
│   ├── ai-standards/                  # This repo (global config)
│   ├── hytopia/                       # Hytopia-specific guidelines
│   │   ├── AGENTS.md                  # Source file
│   │   ├── .ai-install.yml           # Install metadata
│   │   └── .orchestrator-config.json # Orchestrator settings
│   ├── monogame/                      # MonoGame guidelines
│   ├── github/                        # GitHub workflow guidelines
│   └── website/                       # Website dev guidelines
├── scripts/
│   ├── bootstrap.sh                   # Initial setup (clone + symlink)
│   └── sync.sh                        # Update all repos + refresh symlinks
└── hooks/                             # Safety and automation hooks

~/GitHub/                               # Your projects
├── games/
│   ├── hytopia/
│   │   ├── CLAUDE.md → ~/.claude/installed/hytopia/AGENTS.md  # SYMLINK
│   │   ├── .orchestrator-config.json → ~/.claude/installed/hytopia/.orchestrator-config.json
│   │   └── games/
│   │       └── HyFire2/
│   │           └── master/
│   │               └── CLAUDE.md      # Project-specific overrides
│   └── monogame/
│       ├── CLAUDE.md → ~/.claude/installed/monogame/AGENTS.md  # SYMLINK
│       └── epic-survivors/
│           └── master/
│               └── CLAUDE.md          # Project-specific overrides
```

### Configuration Hierarchy (How Claude Reads Instructions)

When Claude starts in a project, it reads CLAUDE.md files from **most specific to most general**:

1. **Project level**: `~/GitHub/games/hytopia/games/HyFire2/master/CLAUDE.md`
   - Project-specific guidelines (game modes, specific architecture, etc.)

2. **Category level**: `~/GitHub/games/hytopia/CLAUDE.md` → `~/.claude/installed/hytopia/AGENTS.md`
   - Framework-specific guidelines (Hytopia SDK, commands, patterns)

3. **Super-category level**: `~/GitHub/games/CLAUDE.md` (if exists)
   - Shared guidelines for all games

4. **Global level**: `~/GitHub/CLAUDE.md` → `~/.claude/CLAUDE.md`
   - Git workflow, branch management, universal standards

This creates a **3-tier hierarchy**:
- **Global** → **Framework** → **Specific Project**

### Shared Agent Configuration Repos

Listed in `~/.claude/shared-repos.yml`:

| Repo | Target Folder | Purpose |
|------|--------------|---------|
| `ai-claude-standards` | `~/.claude/` | Global standards, git workflow, hooks, scripts |
| `agents-hytopia` | `~/GitHub/games/hytopia/` | Hytopia game development guidelines |
| `agents-monogame` | `~/GitHub/games/monogame/` | MonoGame C# game development |
| `agents-github` | `~/GitHub/` | GitHub workflow, PR standards |
| `agents-website` | `~/GitHub/website/` | Website development guidelines |

### How Symlinks Work

Each agent repo has `.ai-install.yml`:

```yaml
name: hytopia
description: HyTopia game development guidelines
source: AGENTS.md

targets:
  claude:
    - ~/GitHub/games/hytopia/CLAUDE.md
  aider:
    - ~/GitHub/games/hytopia/.aider.md
  orchestrator:
    - ~/GitHub/games/hytopia/.orchestrator-config.json
```

When you run `bootstrap.sh` or `sync.sh`:
1. Script reads `.ai-install.yml`
2. Creates parent folders if needed
3. Creates symlink: `~/GitHub/games/hytopia/CLAUDE.md` → `~/.claude/installed/hytopia/AGENTS.md`

### Initial Setup (New Machine)

```bash
# 1. Clone the AI standards repo
git clone https://github.com/web3dev1337/ai-claude-standards ~/.claude
cd ~/.claude

# 2. Run bootstrap (clones all agent repos + creates symlinks)
bash scripts/bootstrap.sh
```

**Output you'll see:**
```
🚀 AI Agent Configuration Bootstrap
====================================
Active AI tools: claude

📦 Processing shared repos...

Processing: ai-standards
  📥 Updating existing repo...
  ✅ Created symlink: ~/GitHub/CLAUDE.md -> AGENTS.md

Processing: hytopia
  📥 Cloning repo...
  ✅ Cloned successfully
  ✅ Created symlink: ~/GitHub/games/hytopia/CLAUDE.md -> AGENTS.md
  ✅ Created symlink: ~/GitHub/games/hytopia/.orchestrator-config.json -> .orchestrator-config.json

Processing: monogame
  📥 Cloning repo...
  ✅ Cloned successfully
  ✅ Created symlink: ~/GitHub/games/monogame/CLAUDE.md -> AGENTS.md

✅ Bootstrap complete!
```

### Updating Agent Configurations

```bash
# Update ALL repos and refresh symlinks
cd ~/.claude
bash scripts/sync.sh

# Or update specific repo manually
cd ~/.claude/installed/hytopia
git pull
```

When anyone on the team updates `agents-hytopia`, you just run `sync.sh` and get the latest!

### Adding a New Agent Repo

1. **Create the repo**: `agents-newframework`
2. **Add files**:
   ```
   agents-newframework/
   ├── AGENTS.md              # Main instructions
   ├── .ai-install.yml        # Install metadata
   └── README.md              # Documentation
   ```

3. **Update `~/.claude/shared-repos.yml`**:
   ```yaml
   - url: https://github.com/web3dev1337/agents-newframework
     name: newframework
     description: New framework guidelines
   ```

4. **Team members sync**:
   ```bash
   cd ~/.claude
   bash scripts/sync.sh
   ```

### Orchestrator Integration

Each agent repo can include `.orchestrator-config.json` for Claude Orchestrator integration:

**Example: `~/.claude/installed/hytopia/.orchestrator-config.json`**

```json
{
  "type": "framework",
  "id": "hytopia-framework",
  "name": "Hytopia SDK",
  "description": "Voxel-based game development framework",
  "category": "games",
  "baseCommand": "hytopia start",
  "commonFlags": {
    "NODE_ENV": {
      "type": "select",
      "options": ["development", "production"],
      "default": "development"
    },
    "AUTO_START_WITH_BOTS": {
      "type": "boolean",
      "default": true
    }
  },
  "defaultTerminalPairs": 6,
  "maxTerminalPairs": 16,
  "icon": "🎮"
}
```

This config:
- ✅ Defines default workspace settings for all Hytopia projects
- ✅ Provides UI hints for launch settings modal
- ✅ Sets recommended terminal pair counts
- ✅ Specifies common environment variables and flags

The orchestrator wizard reads these configs to pre-fill workspace settings!

### Benefits

✅ **Single source of truth**: Update once, propagate everywhere
✅ **Type-safe**: Different guidelines for different project types
✅ **Team collaboration**: Shared repos = shared knowledge
✅ **Version controlled**: All guidelines tracked in git
✅ **AI tool agnostic**: Works with Claude, Cursor, Aider, etc.
✅ **Hierarchical**: Global → Framework → Project specificity
✅ **Orchestrator-aware**: Auto-configures workspace defaults

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

### 2. **CRITICAL FIRST STEP**: Install AI Agent Configuration System

**This must be done BEFORE creating folders or cloning projects!**

```bash
# Clone the AI standards repo to ~/.claude
git clone https://github.com/web3dev1337/ai-claude-standards ~/.claude
cd ~/.claude

# Run bootstrap to install all agent configurations
bash scripts/bootstrap.sh
```

**What bootstrap.sh does:**
- ✅ Reads `shared-repos.yml` (registry of available agent configs)
- ✅ Clones agent repos: `agents-hytopia`, `agents-monogame`, `agents-github`, `agents-website`
- ✅ Creates symlinks at category levels: `~/GitHub/games/hytopia/CLAUDE.md` → `~/.claude/installed/hytopia/AGENTS.md`
- ✅ Sets up orchestrator configs at project levels
- ✅ Installs safety hooks, scripts, and commands

### 3. Create Base Folder Structure

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

### 4. Update Agent Configurations (Triggers Symlink Creation)

```bash
# This creates symlinks at category levels automatically
cd ~/.claude
bash scripts/sync.sh
```

After this step, you should see:
```bash
ls -la ~/GitHub/games/hytopia/CLAUDE.md
# Should be a symlink to ~/.claude/installed/hytopia/AGENTS.md
```

### 5. Clone Your Projects (Following the Convention)

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
ORCHESTRATOR_PORT=9460 # Server port
CLIENT_PORT=9461       # Client UI port
TAURI_DEV_PORT=9463    # Native app port
LOG_LEVEL=info         # Logging level
```

### 4. Launch the Orchestrator

```bash
# Command line (after install-startup.sh)
orchestrator

# OR manually
cd ~/GitHub/tools/automation/claude-orchestrator/master
npm run dev:all

# Access at: http://localhost:9461
```

---

## 🎨 Creating Your First Workspace

### Option 1: Using the Wizard (Recommended)

1. **Launch orchestrator** and open http://localhost:9461
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
        "path": "~/GitHub/games/hytopia/games/HyFire2",
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
        "path": "~/GitHub/games/hytopia/games/HyFire2",
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
        "path": "~/GitHub/games/hytopia/games/hytopia-2d-game-test",
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
        "path": "~/GitHub/games/hytopia/games/hytopia-2d-game-test",
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

# Browser opens automatically at http://localhost:9461
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

**Symptom**: `Error: listen EADDRINUSE :::9460`

**Fix**:
```bash
# Find process using port
lsof -i :9460

# Kill it
kill -9 [PID]

# Or use different port in .env
echo "ORCHESTRATOR_PORT=3001" >> .env
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

For a new co-worker (in this EXACT order):

1. **Install** Node.js v18+ and Git v2.30+
2. **Clone AI standards**: `git clone https://github.com/web3dev1337/ai-claude-standards ~/.claude`
3. **Run bootstrap**: `cd ~/.claude && bash scripts/bootstrap.sh`
4. **Create folder structure**: `mkdir -p ~/GitHub/{games,tools,web,writing,docs}/...`
5. **Verify symlinks created**: `ls -la ~/GitHub/games/hytopia/CLAUDE.md`
6. **Clone projects** into `PROJECT/master/` folders
7. **Clone orchestrator** to `~/GitHub/tools/automation/claude-orchestrator/`
8. **Install deps**: run `npm install` in `claude-orchestrator/master`
9. **Install shortcuts**: `bash scripts/install-startup.sh`
10. **Launch orchestrator**: `orchestrator` or `npm run dev:all`
11. **Create first workspace** using wizard
12. **Switch to workspace** and verify worktrees auto-create
13. **Start coding**

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
