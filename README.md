# Agent Workspace

[![Website](https://img.shields.io/badge/Website-Live%20Site-00d4ff?style=for-the-badge)](https://web3dev1337.github.io/claude-orchestrator/)
[![Download](https://img.shields.io/badge/Download-Windows%20App-00d4ff?style=for-the-badge)](https://github.com/web3dev1337/claude-orchestrator/releases/latest)
[![Follow on X](https://img.shields.io/badge/Follow-%40AIOnlyDeveloper-000000?style=for-the-badge&logo=x)](https://x.com/AIOnlyDeveloper)

A multi-workspace terminal orchestrator for AI coding agents (Claude Code, Codex CLI). Manages unlimited concurrent sessions across multiple repositories with browser-like tabs, dynamic git worktrees, and a native Windows desktop app.

> The repository is named `claude-orchestrator` for historical reasons. The product name is **Agent Workspace**.

## What It Does

Agent Workspace gives you a single UI to run and monitor many AI coding sessions at once. Each workspace can hold 1-16 terminal pairs (agent + server), drawn from any combination of your git repositories. Workspaces live in browser-like tabs so you can switch between projects without losing terminal state.

Key capabilities:

- **Multi-workspace tabs** with full state isolation (terminals, sessions, scroll positions)
- **Mixed-repository workspaces** combining terminals from different repos in one view
- **Dynamic git worktree management** with auto-creation and conflict detection
- **Auto-discovery** of projects under `~/GitHub/` (configurable scan root)
- **Cascaded configuration** at 5 hierarchy levels (global, category, framework, project, worktree)
- **Process workflow layer** with tier tagging (T1-T4), review queue, risk metadata, and prompt artifacts
- **Commander panel** for a top-level AI that orchestrates other sessions
- **Projects kanban board** for tracking work across workspaces
- **Diff viewer** for AI-assisted code review (separate sub-app on its own port)
- **Native Windows app** via Tauri with bundled Node.js backend and auto-updater
- **First-run diagnostics** that check prerequisites and offer one-click repairs

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js** v18+ | Runtime for the backend server |
| **Git** | Required for worktree operations |
| **npm** | Comes with Node.js |

Optional but recommended:

| Tool | Purpose |
|------|---------|
| GitHub CLI (`gh`) | PR review/merge workflows, commander features |
| Claude Code CLI | AI agent sessions |
| Codex CLI | Alternative AI agent sessions |
| Rust + Cargo | Only if building the native desktop app |

On first launch, the diagnostics panel shows what's installed and what's missing, with repair actions for common issues.

## Quick Start

### Web Mode (Linux / WSL / macOS)

```bash
git clone https://github.com/web3dev1337/claude-orchestrator.git
cd claude-orchestrator

# Create .env with your port preferences
cat > .env << 'EOF'
ORCHESTRATOR_PORT=3000
CLIENT_PORT=2080
DIFF_VIEWER_PORT=7655
LOG_LEVEL=info
NODE_ENV=development
ENABLE_FILE_WATCHING=true
EOF

npm install
cd diff-viewer && npm install && cd ..

npm run dev
# Server starts on :3000, UI on :2080
```

Open `http://localhost:2080` in your browser.

### Windows Desktop App (Tauri)

If you have a pre-built installer (`.msi` or `.exe`), just run it. The app bundles Node.js and all dependencies — no dev tools needed.

To build from source:

```bash
# Requires: Node.js, Rust, Visual Studio 2022 (C++ workload)
npm install
npm run tauri:build
# Produces installer in src-tauri/target/release/bundle/
```

The desktop app shows a bootstrap screen on launch, spawns the Node.js backend automatically, and opens the UI once the server is ready (~3-5 seconds).

### First Time Setup

1. Launch the app (web or desktop)
2. The dashboard shows available workspaces (empty on first run)
3. Click **"Create New"** to open the workspace wizard
4. The wizard auto-scans `~/GitHub/` for git repositories, grouped by category
5. Pick a repository (or enter a custom path), set terminal count, and create
6. Your workspace is ready — terminals spawn automatically

## Architecture

```
claude-orchestrator/
├── server/                    # Express.js backend (83 service modules, ~41k lines)
│   ├── index.js              # Entry point, Express + Socket.IO setup
│   ├── sessionManager.js     # Terminal session lifecycle
│   ├── workspaceManager.js   # Workspace CRUD, mixed-repo orchestration
│   ├── worktreeHelper.js     # Git worktree creation and conflict resolution
│   ├── statusDetector.js     # Agent session state monitoring
│   ├── commanderService.js   # Top-level AI orchestration
│   ├── projectBoardService.js # Kanban board backend
│   ├── configDiscoveryService.js # Cascaded config resolution
│   ├── diagnosticsService.js # First-run checks and repairs
│   └── ...                   # 74 more service modules
├── client/                    # Vanilla JS frontend (24 modules)
│   ├── app.js                # Main application, Socket.IO client
│   ├── terminal-manager.js   # XTerm.js terminal grid
│   ├── workspace-tab-manager.js # Browser-like tab system
│   ├── dashboard.js          # Workspace cards and navigation
│   ├── workspace-wizard.js   # 3-step workspace creation
│   ├── commander-panel.js    # Commander AI interface
│   ├── projects-board.js     # Kanban drag-and-drop board
│   └── ...                   # 17 more client modules
├── src-tauri/                 # Rust/Tauri native desktop app
│   ├── src/main.rs           # Backend spawning, port management, auth
│   ├── src/terminal.rs       # Native terminal module
│   ├── src/file_watcher.rs   # File watching via notify-rs
│   └── tauri.conf.json       # App metadata, bundling, updater config
├── diff-viewer/               # Standalone diff/review sub-app
├── templates/launch-settings/ # Per-project-type button/flag configs
├── scripts/                   # Build, migration, release, and CI scripts
├── tests/
│   ├── unit/                  # 81 unit tests (Jest)
│   └── e2e/                   # 35 end-to-end tests (Playwright)
├── .github/workflows/         # CI: tests, gitleaks, Windows Tauri build
├── config/                    # Shared configuration files
├── plugins/                   # Plugin system (extensible)
└── docs/                      # Additional documentation
    ├── windows/              # Windows install and build guides
    ├── diff-viewer/          # Diff viewer setup and features
    └── historical/           # Archived plans and implementation notes
```

### Runtime Data

```
~/.orchestrator/
├── config.json               # Global settings
├── workspaces/               # Workspace definitions (JSON per workspace)
├── task-records.json         # Tier tags, ticket links, risk metadata
└── session-states/           # Persisted terminal states
```

### Key Patterns

- **Service-based architecture**: Each `server/*.js` file is a focused service module
- **Singleton managers**: `SessionManager.getInstance()`, `WorkspaceManager.getInstance()`
- **Real-time communication**: Socket.IO events between server and all clients
- **Cascaded configuration**: 5-level merge (global → category → framework → project → worktree)
- **Event-driven**: Terminal output, session state changes, and workspace switches all via events

## Available Scripts

```bash
# Development
npm run dev              # Backend + UI (web mode)
npm run dev:full         # Backend + UI + Tauri native app
npm run dev:server       # Backend only
npm run dev:client       # UI dev server only
npm run tauri:dev        # Tauri app with hot reload

# Testing
npm run test             # All tests (unit + e2e)
npm run test:unit        # Jest unit tests
npm run test:e2e:safe    # Playwright e2e (auto-picks safe port)

# Building
npm run tauri:build      # Build native Windows/Linux app

# Release prep
npm run audit:public-release           # Scan for secrets/credentials
npm run report:release-readiness       # Generate readiness report
npm run check:command-surface          # Check for API surface drift
```

## Configuration

### Environment Variables (`.env`)

```env
ORCHESTRATOR_PORT=3000       # Backend API port
CLIENT_PORT=2080             # UI dev server port
DIFF_VIEWER_PORT=7655        # Diff viewer port
LOG_LEVEL=info               # Winston log level
NODE_ENV=development
ENABLE_FILE_WATCHING=true    # Watch for file changes in worktrees
```

### Cascaded Project Configs

Place `.orchestrator-config.json` files at any level of your project hierarchy to define custom terminal buttons, game modes, and flags. Configs merge from global down to worktree level.

```json
{
  "buttons": {
    "claude": { "review": { "label": "Review", "command": "gh pr view --web" } },
    "server": { "play": { "label": "Play", "command": "npm run dev" } }
  }
}
```

## Running Two Instances (Dev + Production)

For developing the orchestrator itself while using it for daily work:

| Instance | Directory | Ports | Purpose |
|----------|-----------|-------|---------|
| Production | `claude-orchestrator/master` | 3000 / 2080 / 7655 | Daily AI agent work |
| Development | `claude-orchestrator/claude-orchestrator-dev` | 4000 / 2081 / 7656 | Modifying the orchestrator |

Each instance gets its own `.env` with different port numbers. Both can run simultaneously.

## CI / CD

Three GitHub Actions workflows:

- **`tests.yml`** — Unit tests on every push
- **`gitleaks.yml`** — Secret scanning on every push
- **`windows.yml`** — Windows unit tests + Tauri installer build (on tags or manual dispatch)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE)
