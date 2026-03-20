# Claude Orchestrator Codebase Documentation

🚨 **READ THIS ENTIRE FILE** 🚨
**CRITICAL: You MUST read this complete file from start to finish. Do not truncate or skip sections.**

Essential reference for navigating the multi-terminal orchestrator codebase. Read this FIRST before implementing any feature.

**IMPORTANT**: Before creating pull requests, please update this document if you have added any new files or systems or made significant changes where the documentation is inaccurate.

## Quick Navigation Patterns

```
ENTRY:      server/index.js                          - Main server entry point
CORE:       server/sessionManager.js                 - Terminal session management
SERVICES:   server/statusDetector.js, gitHelper.js   - Core services
FRONTEND:   client/app.js, client/terminal.js        - Web client
NATIVE:     src-tauri/src/main.rs                    - Native desktop app
CONFIG:     config.json, package.json                - Configuration files
GUIDES:     CLAUDE.md, AGENTS.md                     - Repo workflow + release guardrails for contributors/agents
META:       .github/FUNDING.yml                      - GitHub Sponsors button configuration
PACKAGING:  scripts/tauri/prepare-backend-resources.js - Bundles backend resources + reusable packaged prod deps
            scripts/tauri/run-tauri-build.js          - Centralized Tauri build entrypoint (local Windows fast-cache pinning + profile dispatch)
            scripts/tauri/get-release-version.js     - Extracts the release version (tag or package.json) and exports it for CI jobs.
            scripts/tauri/sync-tauri-version.js      - Mirrors the release version into `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` before packaging.
            scripts/release/check-version-consistency.js - Fails builds/tags when package/Tauri/Cargo/tag versions drift.
            scripts/release/verify-bundle-version.js - Rejects stale bundle filenames before GitHub release upload.
DIFF:       diff-viewer/                             - Advanced diff viewer component
SITE:       site/                                    - Standalone showcase site for future GitHub Pages publishing
PLANS:      PLANS/                                   - Date-stamped planning + implementation notes
```

## Core Systems (Start Here)

### Backend Server
```
server/index.js                    - Express server with Socket.IO
├─ Manages: HTTP routes, WebSocket connections, service orchestration
├─ Key endpoints: /api/status, /api/sessions, /api/git
├─ Socket events: session-created, terminal-output, status-change
└─ Singleton services: SessionManager, StatusDetector, GitHelper

server/sessionManager.js           - Terminal session lifecycle management
├─ Manages: PTY processes, session tracking, cleanup
├─ Key methods: createSession(), destroySession(), getActiveSessions()
├─ Windows PTY policy: `buildPtyOptions()` forces ConPTY for orchestrator-launched terminals to reduce stray console-window behavior on Windows
├─ Windows shell policy: PTY shells keep `PowerShell`/`cmd` inside ConPTY without requesting `-WindowStyle Hidden`, avoiding transparent ghost-console windows in packaged GUI builds
├─ Cleanup hardening: closing sessions sends process-tree SIGTERM and a grace-timed SIGKILL fallback by PTY pid to reduce orphaned agent processes
├─ Workspace cleanup: `cleanupWorkspaceSessions(workspaceId)` tears down active or stashed sessions for a specific workspace before delete/archive flows
├─ Workspace switch guard: switching to the already-active workspace short-circuits and reuses the current session map instead of re-initializing PTYs
├─ Stale-agent cleanup: when status detection sees an explicit shell/no-agent prompt, recovery `lastAgent` markers are cleared to keep sidebar status accurate (`no-agent` vs `busy/waiting`)
├─ Status model: periodic status re-evaluation prevents stale "busy" lights after output quiets down
└─ Uses: node-pty for terminal emulation

server/statusDetector.js           - Claude Code session monitoring
├─ Detects: Claude sessions, branch changes, status updates
├─ Busy/idle heuristics: tool/typing signals are recency-gated to avoid stale "busy forever" states
├─ Events: session-detected, branch-changed, status-updated
└─ Polling: Configurable intervals for status checks

server/gitHelper.js                - Git operations wrapper
├─ Operations: branch info, status, commit history, remote tracking
├─ Key methods: getCurrentBranch(), getStatus(), getBranchInfo()
└─ Error handling: Git command failures, repository state
```

### Services & Utilities
```
server/notificationService.js      - System notification manager
server/claudeVersionChecker.js     - Claude Code version detection
tests/unit/claudeVersionChecker.test.js - Coverage for update-banner version fallback messaging
tests/unit/claudeVersionChecker.spawnOptions.test.js - Verifies Windows-hidden spawn flags for startup Claude version checks
tests/unit/worktreeHelper.spawnOptions.test.js - Verifies Windows-hidden spawn flags for auto-created worktree git commands
tests/unit/commanderService.test.js - Covers Commander launch buffering, trust-prompt auto-accept, and preserved output history
tests/unit/sessionManager.trustPrompt.test.js - Verifies auto-accept of Claude folder trust prompts in launched worktree sessions
tests/unit/sessionManager.agentDetection.test.js - Covers manual Gemini command detection so provider-specific status heuristics receive the correct agent id
server/utils/processUtils.js       - Shared spawn/env hardening helpers
├─ Windows packaging guardrails: applies `windowsHide`/`CREATE_NO_WINDOW`, augments GUI-app PATH with Git/node/npm/common CLI locations, and builds hidden PowerShell argument lists
└─ Cross-platform behavior: non-Windows platforms pass through unchanged so Linux/macOS launch behavior stays stable
server/utils/pathUtils.js          - Shared slash-normalization helpers for repo/worktree labels
└─ Used by server-side workspace/conversation flows to keep Windows backslash paths compatible with Linux-style UI labels
server/tokenCounter.js             - Token usage tracking (if applicable)
server/userSettingsService.js      - User preferences and settings management
server/sessionRecoveryService.js   - Session recovery state persistence (CWD, agents, conversations)
├─ Recovery filtering: stale/non-configured session entries are pruned when requested by workspace-scoped APIs
├─ Agent clearing: `clearAgent()` resets stale `lastAgent` markers when a Claude/Codex terminal falls back to plain shell
└─ Recovery metadata: recovery payload includes configured terminal/worktree counts for UI context
server/threadService.js            - Workspace/project thread persistence (`~/.orchestrator/threads.json`)
├─ Thread identity: active-thread de-dup scopes by workspace + worktree + repository context
├─ Project identity: `projectId` is repository-scoped (`repo-path:*` / `repo-name:*`) instead of workspace-scoped when repository context is available
├─ Repository normalization: thread/worktree creation normalizes `.../master` and `.../workN` paths to repository root
├─ New chat reuse: thread creation prefers an existing repo worktree without an active thread before allocating a new `workN`
├─ Project aggregation: `listProjects()` returns repository-level chat rollups across one/many workspaces
└─ Lifecycle: create/list/close/archive + session association updates
server/projectBoardService.js      - Local projects kanban board persistence (`~/.orchestrator/project-board.json`) + APIs (`GET /api/projects/board`, `POST /api/projects/board/move`, `POST /api/projects/board/patch`)
server/discordIntegrationService.js - Discord queue orchestration bridge (Services workspace ensure/start, signed queue verification, invocation idempotency, JSONL audit log for processing dispatch/replay/fail paths)
server/intentHaikuService.js       - Session intent summarizer for context-switch hints (optional Anthropic Haiku model, heuristic fallback)
server/threadWorktreeSelection.js  - Repository/worktree normalization + reuse-first candidate selection for thread creation
server/policyService.js            - Role/action policy checks (viewer/operator/admin) for sensitive APIs + command execution
server/policyBundleService.js      - Policy template catalog + bundle export/import for team governance profiles
server/pluginLoaderService.js      - Plugin manifest validation/compatibility, command registration safety, and client slot metadata
server/agentProviderService.js     - Provider abstraction layer for Claude/Codex/future agents (sessions, resume plans, history search, transcript fetch)
server/workspaceServiceStackService.js - Workspace service-stack manifest normalization/validation (services, env, restart policy, healthchecks)
server/configPromoterService.js    - Team/shared service-stack baseline promotion + attach/resolve with optional signature verification
server/encryptedStore.js           - Reusable AES-256-GCM encrypted JSON store helper for shared config artifacts
server/serviceStackRuntimeService.js - Workspace service-stack runtime supervisor (start/stop/restart, desired state, auto-restart, health checks)
server/auditExportService.js       - Redacted audit export across activity + scheduler logs (JSON/CSV)
server/networkSecurityPolicy.js    - Bind-host/auth safety policy helpers (loopback defaults + LAN auth guardrails)
server/processTelemetryBenchmarkService.js - Release benchmark metrics (onboarding/runtime/review), snapshot comparisons, release-note markdown generation
server/projectTypeService.js       - Project taxonomy loader/validator for category→framework→template metadata (`config/project-types.json`)
server/githubCloneWorktreeService.js - GitHub import flow for Quick Work (`owner/repo` parse, category/subfolder placement, clone into `master/`, and mixed-worktree bootstrap)
server/portRegistry.js             - Port assignment + live service scanner (`/api/ports/scan`)
├─ Windows scan path: uses hidden `netstat`/`tasklist` probes so packaged Tauri builds do not flash console windows when Ports/Dashboard panels refresh
└─ UI metadata: labels orchestrator-assigned ports, known dev servers, and custom user labels
scripts/tauri/prepare-backend-resources.js - Tauri backend packager
├─ Bundles: server/client/config/templates/scripts + optional Node runtime into `src-tauri/resources/backend`
├─ Resource-sync reuse: repeated runs skip recopying server/client/templates/config payloads when the source-tree stamp still matches
├─ Prod-deps reuse: repeated `--install-prod` runs skip `npm ci` when package-lock + bundled Node stamp still match
└─ CI cache: Windows release workflow restores `src-tauri/resources/backend/node_modules` so warm installer builds avoid re-installing backend prod deps
scripts/tauri/run-tauri-build.js    - Shared local/CI Tauri build launcher
├─ Profiles: dispatches `release` vs `fast` builds from one script instead of duplicating shell commands
├─ Windows fast-cache pinning: local non-CI `fast` builds use a stable `%LOCALAPPDATA%\\AgentWorkspaceBuildCache\\tauri-target` root so repo renames/worktree moves do not discard Cargo incremental state
├─ Local installer trim: local non-CI Windows `fast` builds default to `nsis` instead of building both Windows installer formats
├─ Version guardrails: syncs Tauri/Cargo metadata from `package.json`, runs release consistency checks, and clears stale bundle output before each build
├─ Artifact verification: blocks CI/local release builds if installer filenames in `bundle/` do not include the expected version
└─ Overrides: respects explicit `CARGO_TARGET_DIR` / `ORCHESTRATOR_TAURI_TARGET_DIR` when callers want a custom target root
scripts/release/check-version-consistency.js - Release metadata guardrail
├─ Validates: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the active Git tag (when present)
└─ CI usage: runs in PR/main workflows so version drift cannot merge silently
scripts/release/verify-bundle-version.js - Bundle filename verifier
├─ Validates: Windows `.exe`/`.msi` and macOS `.dmg` filenames include the expected release version
└─ Failure mode: catches stale cached artifacts that wildcard GitHub release uploads would otherwise attach
scripts/debug/                      - Manual debug helpers kept out of the repo root
├─ `test-button-merge.js` verifies config merge behavior against `WorkspaceManager`
└─ `test-cascade-debug.js` prints cascaded config layers for manual inspection
scripts/local/                      - Local-machine setup helpers for non-portable workflows
├─ `check-environment.sh` checks CLI/dependency availability for older local setups
└─ `setup-claude-hooks.sh` writes local Claude hook config for legacy `HyFire2-workN` layouts
scripts/mobile/start-mobile.sh      - LAN/mobile launch helper with auth token output and safe port-in-use guard
scripts/windows/allow-firewall.ps1  - Adds a Windows firewall rule for the default app port
scripts/windows/allow-node-firewall.ps1 - Adds a Windows firewall rule for the current Node executable
```

### Multi-Workspace System (Core Feature)
```
server/workspaceManager.js          - Workspace lifecycle management
├─ Manages: Workspace creation, switching, mixed-repo support
├─ Features: Dynamic terminal creation, worktree integration
├─ Deleted workspace archive: deleting a workspace moves its JSON into `~/.orchestrator/deleted-workspaces/` instead of permanently unlinking it
└─ Storage: JSON-based workspace persistence with dashboard-driven restore via the deleted-workspace archive

server/workspaceSchemas.js          - Workspace configuration validation
├─ Schemas: JSON schema definitions for workspace types
└─ Validation: Ensures workspace integrity and structure

server/workspaceTypes.js            - Workspace type definitions
├─ Types: Single-repo, mixed-repo, custom configurations
└─ Templates: Default settings for different workspace types

server/worktreeHelper.js            - Git worktree operations wrapper
├─ Operations: Create, delete, manage git worktrees
├─ Bootstrap helper: `createProjectWorktrees({ projectPath, count, baseBranch })` for initial `workN` creation
├─ Integration: Seamless workspace-worktree coordination
└─ Safety: Path validation and cleanup handling
```

### Cascaded Configuration System (NEW)
```
server/workspaceManager.js          - Config cascade implementation
├─ Hierarchy: Global → Category → Framework → Project → Worktree
├─ Methods: getCascadedConfig(), getCascadedConfigForWorktree(), mergeConfigs()
├─ Features: Deep merge, worktree-specific overrides, cache prevention
└─ API: /api/cascaded-config/:type?worktreePath=...

server/configDiscoveryService.js    - Dynamic config discovery
├─ Discovers: Game/framework/category configs from file hierarchy
├─ Structure: ~/GitHub/games/hytopia/.orchestrator-config.json
└─ Auto-detection: Scans master/ subdirectory for worktree-based projects

Config File Hierarchy:
  ~/GitHub/.orchestrator-config.json              (Global)
  ~/GitHub/games/.orchestrator-config.json        (Category)
  ~/GitHub/games/hytopia/.orchestrator-config.json (Framework)
  ~/GitHub/games/hytopia/games/HyFire2/.orchestrator-config.json (Project)
  ~/GitHub/games/hytopia/games/HyFire2/work1/.orchestrator-config.json (Worktree)

Config Structure:
{
  "buttons": {
    "claude": { "review": {...}, "replay": {...} },
    "server": { "play": {...}, "build": {...}, "kill": {...} }
  },
  "gameModes": {
    "deathmatch": { "flag": "--mode=deathmatch", "label": "Deathmatch" }
  },
  "commonFlags": {
    "unlockAll": { "flag": "--unlock-all", "label": "Unlock All" }
  }
}

client/app.js                       - Config pre-fetching & caching
├─ Methods: prefetchWorktreeConfigs(), fetchCascadedConfig(), ensureProjectTypeTaxonomy()
├─ Cache: Map<sessionId, config> for worktree-specific configs
└─ Extract: extractRepositoryName() from workspace config
```

## Frontend Applications

### Web Client
```
client/app.js                      - Main client application
├─ Manages: UI state, socket connections, terminal grid
├─ Features: 16-terminal layout, real-time updates, session switching
├─ Command Palette: header `⌘ Commands` button + `Ctrl/Cmd+K` searchable command launcher for command-catalog actions
├─ Intent hints: compact "intent haiku" strip above each agent terminal, refreshed from `POST /api/sessions/intent-haiku`
├─ Projects + Chats automation: `project-chats-new` Commander/voice action supports explicit workspace + repository targeting
├─ Projects + Chats list: repository-first aggregation (project-centric view) while preserving workspace context for mixed workspaces
├─ Projects + Chats data source: prefers server-aggregated repository projects from `GET /api/thread-projects` with client fallback aggregation
├─ Quick Work cache: local scan + GitHub repo lists use a configurable cache window (`ui.worktrees.repoCatalogCacheMinutes`, default 1440) with manual Refresh button support
├─ Quick Work GitHub import: “GitHub — Not Cloned” rows can clone directly or open a placement modal (category/framework/parent folders) before auto-starting `work1`
├─ Quick Work onboarding: first-run hint card + “Folder map” modal explain category→folder mapping (`game -> games`, `website -> websites`, etc.) for fresh installs
├─ Status UI: visual state mapping for `busy`, `waiting`, `ready-new`, and `no-agent`
└─ Dependencies: Socket.IO client, terminal emulation

client/assets/agent-workspace-logo.png - Shared circular brand mark used by the app favicon, sidebar/dashboard title logo, and as the source for bundled desktop icons

client/terminal.js                 - Terminal component implementation
client/terminal-manager.js         - Terminal lifecycle management
client/file-watcher-adapter.js     - File watching integration
client/notifications.js            - Browser notification handling

client/workspace-switcher.js       - Workspace switching interface
├─ Features: Quick workspace switching, status display
└─ UI: Dropdown selector with workspace metadata

client/workspace-wizard.js         - Workspace creation wizard
├─ Features: Step-by-step workspace setup, repo selection
├─ Types: Single-repo, mixed-repo, and custom configurations
└─ Integration: Worktree creation and template application

client/greenfield-wizard.js        - New-project wizard (greenfield creation flow)
client/greenfield-framework-modal.js - Framework creation modal for the greenfield wizard
├─ Uses project taxonomy categories before rendering
├─ Calls `orchestrator.createProjectWorkspace(options)` to centralize socket + REST fallback (`POST /api/projects/create-workspace`)
├─ Category → framework → template drilldown based on taxonomy relationships
├─ GitHub controls: supports optional local-only creation (`createGithub=false`), explicit repo target (`owner/repo` or URL), and optional GitHub org/user prefix
├─ Workspace-context suggestion (repo type -> recommended template/framework defaults)
└─ Full-screen wizard UI for project scaffolding + workspace creation

client/projects-board.js           - Projects kanban board modal (Archive/Maybe One Day/Backlog/Active/Ship Next/Done; drag/drop + re-order; collapsible columns; live tag; hide forks; persists via `/api/projects/board`)

client/workspace-tab-manager.js    - Multi-workspace tab management (NEW)
├─ Features: Browser-like tabs for multiple workspaces
├─ Manages: Tab creation, switching, state preservation
├─ Workspace deletion sync: `removeWorkspaceTabs(workspaceId)` prunes tabs when a workspace is deleted from the dashboard
├─ XTerm lifecycle: Proper hide/show with fit() handling
├─ Notifications: Badge counts for inactive tabs
└─ Keyboard shortcuts: Alt+←/→, Alt+W, Alt+N, Alt+Shift+N, Alt+1-9

client/styles/tabs.css             - Tab bar styling
├─ Features: Tab UI, badges, animations
└─ Responsive: Mobile and desktop layouts

client/styles/projects-board.css   - Projects Board modal styling

client/plugin-host.js              - Client plugin runtime for UI slots/actions
├─ Loads: `/api/plugins/client-surface` slot actions with cache/refresh support
├─ Exposes: `window.orchestratorPluginHost`
└─ Supports actions: open_url, open_route, copy_text, commander_action
```

### Tabbed Workspace System (NEW)
The orchestrator now supports having multiple workspaces open simultaneously in browser-like tabs:

**Key Features:**
- Open multiple workspaces without closing others
- Seamless tab switching with preserved terminal state
- XTerm instances remain alive when switching tabs
- Notification badges show activity in inactive tabs
- Keyboard shortcuts for power users
- No visual glitches or layout shifts on switch

**Architecture:**
```
WorkspaceTabManager
├─ Tab Registry: Map<tabId, TabState>
├─ Active Tab Tracking: Current visible workspace
├─ XTerm Lifecycle: Hide/show with proper fit() timing
└─ Event Routing: Notifications for inactive tabs

TabState Structure:
{
  id: 'tab-uuid',
  workspaceId: 'workspace-id',
  workspace: {...},
  isActive: boolean,
  notifications: number,
  sessions: Map<sessionId, sessionData>,
  terminals: Map<sessionId, xtermInstance>,
  containerElement: DOMElement,
  resizeObserver: ResizeObserver
}
```

**Critical Implementation Details:**
- Double `requestAnimationFrame()` before fitting terminals (prevents race conditions)
- Resize observers disconnected when hiding tabs
- Scroll positions and cursor states preserved
- Terminal output continues in background tabs
- Tab-aware session management in app.js

**Usage:**
- Click "+" button to open new workspace
- Click tab to switch
- Click "×" to close tab (confirms if terminals active)
- `Ctrl/Cmd+K` opens the command palette for quick command execution
- Alt+← / Alt+→ to cycle tabs (previous/next)
- Alt+1-9 to jump to specific tab
- Alt+N for new workspace
- Alt+Shift+N for full-screen New Project wizard
- Alt+W to close current tab

Dashboard notes:
- "Create Workspace" card remains for workspace-only setup
- "New Project" card opens the greenfield wizard directly
- Terminal headers include a `✨` quick action to open the New Project wizard from any session
- Recovery prompt explicitly separates "recoverable sessions" from total configured worktree/terminal counts

```

### Native Desktop App (Tauri)
```
src-tauri/src/main.rs              - Tauri application entry point
├─ Features: Native performance, system integration, tray icon
├─ Commands: File operations, system notifications, window management
├─ Windows identity: sets an explicit AppUserModelID before UI startup so packaged WebView2 windows group as Agent Workspace instead of a generic host process
└─ Frontend: Rust backend + web frontend hybrid

src-tauri/src/terminal.rs          - Native terminal integration
src-tauri/src/file_watcher.rs      - Native file watching
src-tauri/src/lib.rs               - Tauri application library
```

### Configuration Files
```
src-tauri/tauri.conf.json          - Tauri app configuration
├─ Bundle metadata: packaged app name/version, cross-platform icons (`.png`/`.icns`/`.ico`), Linux GTK app identity, Windows publisher branding, and Windows installer license/EULA file path
src-tauri/Cargo.toml               - Rust dependencies + build profiles (release, fast)
├─ Windows EXE metadata: `package.metadata.tauri-winres` sets embedded identity fields like `InternalName`, `OriginalFilename`, and comments for the packaged binary
├─ profile.release: lto=true, codegen-units=1, opt-level="s" — smallest binary, slow compile (CI/distribution)
└─ profile.fast: lto=false, codegen-units=256, incremental — ~3-5x faster compile (local dev/testing)
config.json                        - Shared application configuration
config/project-types.json          - Greenfield category/framework/template taxonomy (supports framework pathSuffix defaults)
package.json                       - Node.js dependencies and scripts

user-settings.json                 - User preferences and workspace settings
user-settings.default.json         - Default user settings template
```

### Workspace Templates & Scripts
```
templates/launch-settings/         - Workspace configuration templates
├─ hytopia-game.json              - Gaming project workspace template
├─ website.json                   - Web development workspace template
└─ writing.json                   - Writing/documentation workspace template

scripts/migrate-to-workspaces.js   - Migration script for legacy workspaces
├─ Converts: Old workspace format to new multi-workspace format
└─ Safety: Backup and rollback capabilities

scripts/public-release-audit.js    - Public-release safety audit automation
├─ Checks: tracked cache/DB artifacts, public-doc path hygiene, loopback/auth defaults
└─ Optional: full-history gitleaks scan (`--history-secrets`)
scripts/render-legal-pages.js      - Generates `site/terms.html` and `site/privacy.html` from canonical markdown in `docs/legal/`

scripts/create-project.js          - Taxonomy-driven project scaffold generator (template/project-kit source resolution, optional post-create hooks, git init, optional GitHub remote, worktree bootstrap via WorktreeHelper)
scripts/preview-site.js            - Tiny local preview server for the standalone `site/` showcase
```

### Standalone Showcase Site
```
site/                              - Concise product/showcase site kept separate from internal docs for future GitHub Pages deployment
├─ index.html                      - Single-page product overview and quick-start narrative
├─ terms.html                      - Generated public Terms of Use page linked from footer + install/download flows
├─ privacy.html                    - Generated public Privacy Policy page linked from footer + install/download flows
├─ robots.txt                      - Crawl policy for search/AI bots + sitemap declaration
├─ sitemap.xml                     - Canonical URL inventory for core public pages
├─ llms.txt                        - Short AI-oriented summary + canonical product links
├─ llms-full.txt                   - Extended AI-oriented product details for retrieval/chat assistants
├─ lllms.txt / llm.txt / llm-full.txt - Compatibility aliases for typo/guess-path AI metadata requests, each pointing back to canonical `llms*.txt`
├─ styles.css                      - Showcase visual system, layout, and motion
├─ script.js                       - Small reveal-on-scroll enhancement
├─ assets/                         - Favicon, provider logos, generated Open Graph preview, and real UI screenshots (home page, diff viewer, projects, ports, tabs)
└─ README.md                       - Local preview and future publishing notes
```

### Legal Documents
```
docs/legal/                        - Product-specific legal docs used by the website, README, and Windows installer
├─ TERMS_OF_USE.md                 - Canonical product-facing terms covering desktop app, downloads, website, AI use, and liability posture
├─ PRIVACY_POLICY.md               - Canonical local-first/privacy disclosures describing on-device storage and optional third-party integrations
└─ WINDOWS_INSTALLER_EULA.txt      - Plain-text Windows installer agreement referenced by `src-tauri/tauri.conf.json`
```

## Advanced Diff Viewer Component

### Diff Viewer Architecture
```
diff-viewer/                       - Complete diff analysis tool
├─ client/                         - React frontend
│   ├─ src/components/            - UI components
│   └─ src/hooks/                 - React hooks
├─ server/                         - Express backend
│   ├─ api/                       - REST API endpoints
│   ├─ diff-engine/               - Analysis engines
│   └─ cache/                     - Caching system
└─ examples/                       - Test cases
```

### Diff Viewer Core Components
```
diff-viewer/server/index.js        - Diff viewer backend
diff-viewer/server/api/diff.js     - Diff processing API
diff-viewer/server/api/ai-summary.js - AI analysis integration
diff-viewer/server/diff-engine/engine.js - Core diff engine

diff-viewer/client/src/App.jsx    - Main React application
diff-viewer/client/src/components/DiffViewer.jsx - Primary diff component
diff-viewer/client/src/components/SmartDiffViewer.jsx - Advanced analysis view
```

## Socket.IO Event System

### Server → Client Events
```
session-created: {sessionId, type, config}     - New terminal session
terminal-output: {sessionId, data}             - Terminal output data
session-destroyed: {sessionId}                 - Session cleanup
status-change: {type, data}                    - Claude status updates
git-change: {branch, status, commits}          - Git repository changes
notification: {type, message, level}           - System notifications
workspace-changed: {workspaceId, sessions}     - Workspace switch completed
workspace-list: {workspaces}                   - Available workspaces update
```

### Client → Server Events
```
create-session: {type, config}                 - Request new session
destroy-session: {sessionId}                   - Close session
terminal-input: {sessionId, input}             - Send input to terminal
request-status: {}                             - Request status update
git-command: {command, args}                   - Execute git command
switch-workspace: {workspaceId}                - Switch to different workspace
create-workspace: {config}                     - Create new workspace
get-workspaces: {}                             - Request workspace list
create-new-project: {name, category, template, ...} - Create project scaffold + workspace in one socket action
close-tab: {tabId}                             - Close workspace tab and cleanup sessions (NEW)
```

## Configuration System

### Main Configuration (config.json)
```json
{
  "server": {
    "port": 3001,
    "cors": {
      "origins": ["http://localhost:2080", "tauri://localhost"]
    }
  },
  "sessions": {
    "maxConcurrent": 16,
    "timeout": 3600000,
    "cleanupInterval": 60000
  },
  "monitoring": {
    "statusInterval": 5000,
    "gitInterval": 2000
  },
  "logging": {
    "level": "info",
    "maxFiles": 5,
    "maxSize": "10m"
  }
}
```

### Environment Variables (.env)
```
PORT=3001
LOG_LEVEL=info
NODE_ENV=development
ENABLE_FILE_WATCHING=true
WORKSPACE_SCAN_MAX_DEPTH=6        # optional, clamp 1-12 for /api/workspaces/scan-repos depth
```

## Development Workflow

### Local Tauri Build Prerequisites

**1. Rust toolchain** (no sudo needed):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

**2. System libraries** (Ubuntu/WSL — needs sudo):
```bash
# Ubuntu 24.04+
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# Ubuntu 22.04 and earlier
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf
```

**3. Node.js dependencies** (already handled by `npm install`):
```bash
npm install   # installs Tauri CLI as devDependency
```

**3a. WSL extra** (AppImage bundling fails in WSL due to missing FUSE — use `-b deb` to skip it):
```bash
sudo apt-get install -y libayatana-appindicator3-dev
npx tauri build -b deb -- --profile fast   # skip AppImage, build .deb only
```

**Disk space**: First build downloads ~250 MB of Rust crates and needs ~3-5 GB for compilation artifacts.
**First build**: ~43s (compiles all 550+ crates). **Rebuilds**: ~2-3s (incremental).

### Project Scripts
```
npm run dev              - Start development server
npm run dev:client       - Start client dev server
npm run tauri:dev        - Start native app development
npm run tauri:build      - Release build (slow, optimized — for distribution)
npm run tauri:build:fast - Fast build (~3-5x faster — for local testing)
npm run dev:all          - Start all services concurrently

# Diff viewer specific
cd diff-viewer && npm start     - Start diff viewer
./start-diff-viewer.sh          - Convenience script
```

### Service Management
```
SessionManager.getInstance()     - Get session manager singleton
StatusDetector.startMonitoring() - Begin status monitoring
GitHelper.getCurrentBranch()     - Get current git branch
NotificationService.send()       - Send system notification
```

## Performance Considerations

### Native App Advantages
- **Startup**: 200-500ms vs 2-5s (browser)
- **Memory**: 150-300MB vs 600MB+ (browser)  
- **Latency**: 15-50ms vs 50-150ms (browser)

### Optimization Strategies
- Terminal output buffering for performance
- Session cleanup to prevent memory leaks
- Efficient git status polling
- Socket.IO event throttling for high-frequency updates

## API Reference

### REST Endpoints
```
GET /api/status                    - Server and session status
GET /api/sessions                  - List active sessions
POST /api/sessions                 - Create new session
DELETE /api/sessions/:id           - Destroy session
GET /api/git/status               - Git repository status
GET /api/git/branches             - Available branches

GET /api/workspaces               - List all workspaces
POST /api/workspaces              - Create new workspace
PUT /api/workspaces/:id           - Update workspace configuration
DELETE /api/workspaces/:id        - Delete workspace
POST /api/workspaces/:id/switch   - Switch to workspace
POST /api/workspaces/remove-worktree - Remove worktree from workspace config (mixed terminal arrays and numeric `terminals.pairs` modes), close linked sessions, prune matching recovery orphans even when config entry is already missing, keep files on disk
GET /api/threads                  - List project/workspace chats (`workspaceId` required)
GET /api/thread-projects          - List repository-level chat projects aggregated from threads (optionally `workspaceId` scoped)
POST /api/threads                 - Create thread + ensure mixed worktree/session context
POST /api/threads/create          - Alias for thread creation API used by Projects + Chats shell (idempotent for existing worktrees/sessions)
POST /api/threads/:id/close       - Mark thread closed and close linked sessions
POST /api/threads/:id/archive     - Archive thread (hidden unless includeArchived=true)
GET /api/project-types            - Full project taxonomy (categories/frameworks/templates + metadata)
GET /api/project-types/categories - Project categories with resolved base paths
GET /api/project-types/frameworks?categoryId=... - Framework catalog (optionally scoped by category)
POST /api/project-types/frameworks - Add a framework to the project taxonomy
GET /api/project-types/templates?frameworkId=...&categoryId=... - Template catalog (optionally scoped)
GET /api/github/repos             - List GitHub repositories via `gh` (owner/limit/force supported)
POST /api/github/clone-and-add-worktree - Clone `owner/repo` into taxonomy-guided folder placement (`<repo>/master`) and attach/start a mixed worktree (default `work1`)
POST /api/projects/create-workspace - Create project scaffold + matching workspace in one request
GET /api/discord/status            - Discord queue + services health/status (counts + signature status); endpoint can be gated by `DISCORD_API_TOKEN`
POST /api/discord/ensure-services  - Ensure Services workspace/session bootstrap; accepts optional `dangerousModeOverride` (gated by `DISCORD_ALLOW_DANGEROUS_OVERRIDE`)
POST /api/discord/process-queue    - Dispatch queue processing prompt with optional `Idempotency-Key`/`idempotencyKey`, queue signature verification, idempotent replay, audit logging, and per-endpoint rate limiting
POST /api/sessions/intent-haiku   - Generate <=200 char intent summary for an active Claude/Codex session
GET /api/greenfield/categories    - Greenfield category list (taxonomy-backed)
POST /api/greenfield/detect-category - Infer category from description (taxonomy keyword matching)
GET /api/setup-actions            - List Windows dependency-onboarding actions
GET /api/setup-actions/state      - Read persisted dependency-onboarding state (completed/dismissed/current step)
PUT /api/setup-actions/state      - Persist dependency-onboarding state into app data for desktop restarts
GET /api/user-settings            - Get user preferences
PUT /api/user-settings            - Update user preferences

GET /api/process/telemetry/benchmarks                         - Live + snapshot benchmark rows for onboarding/runtime/review comparisons
POST /api/process/telemetry/benchmarks/snapshots              - Capture a named benchmark snapshot for release tracking
GET /api/process/telemetry/benchmarks/release-notes           - Build markdown release notes comparing current vs baseline benchmark
GET /api/policy/templates                                    - Built-in team governance policy templates
POST /api/policy/bundles/export                              - Export policy bundle (template/current/custom) for sharing
POST /api/policy/bundles/import                              - Apply policy bundle (replace/merge) into global settings
GET /api/audit/export?signed=1                               - Signed audit export (HMAC-SHA256; requires signing enabled + secret)
GET /api/agent-providers                                      - List registered agent providers and capabilities
GET /api/agent-providers/:providerId/sessions                 - List provider sessions from SessionManager
POST /api/agent-providers/:providerId/resume-plan             - Build provider-specific resume command/config plan
GET /api/agent-providers/:providerId/history/search           - Provider-scoped history search (conversation index source-aware)
GET /api/agent-providers/:providerId/history/:id              - Provider-scoped transcript retrieval
```

### WebSocket Events
See "Socket.IO Event System" section above for complete event reference.

## Error Handling

### Common Error Patterns
1. **Session Creation Failures**: PTY spawn errors, resource limits
2. **Git Operation Failures**: Repository state, permissions, network
3. **Socket Disconnections**: Client reconnection, session recovery
4. **File System Errors**: Permissions, disk space, path issues

### Error Recovery
- Automatic session cleanup on client disconnect
- Git operation retry with exponential backoff
- Graceful degradation when services unavailable
- Client-side error boundaries for UI stability

## Security Considerations

### Input Validation
- Terminal input sanitization
- Git command argument validation
- File path restriction to project directory
- Socket event payload validation

### Access Control
- CORS configuration for allowed origins
- Session ownership validation
- Rate limiting for API endpoints
- File system access restrictions

## Critical Patterns

```
ARCHITECTURE: Service-oriented with Socket.IO communication
SESSIONS:     PTY-based terminal sessions with cleanup
MONITORING:   Polling-based status detection with events
FRONTEND:     Real-time UI updates via WebSocket
NATIVE:       Tauri hybrid app with Rust backend
CONFIG:       JSON-based configuration with environment overrides
LOGGING:      Winston-based structured logging with rotation
```

## Common Gotchas

1. PTY sessions need proper cleanup to prevent resource leaks
2. Socket.IO CORS must include all client origins (web + Tauri)
3. Git operations should always be async with proper error handling
4. Terminal output can be high-frequency - use throttling
5. Native app requires different event handling than web client
6. File watching can be resource intensive - use efficient patterns
7. **Workspace switching**: Ensure all sessions are properly cleaned up before switch
8. **Worktree creation**: Validate paths and handle existing worktree conflicts
9. **Mixed-repo workspaces**: Terminal naming must avoid conflicts between repos
10. **Template validation**: Always validate workspace templates against schemas


## First-Run Dependency Onboarding (Windows)

```
server/setupActionService.js     - Defines setup actions and launches PowerShell installers
server/onboardingStateService.js - Persists Windows dependency-onboarding state in app data so Tauri restarts survive per-launch localhost ports
server/index.js                  - Routes: GET/PUT /api/setup-actions/state plus setup action execution endpoints
client/app.js                    - Guided dependency onboarding steps + diagnostics integration
client/index.html                - Dependency onboarding modal markup + launch button
client/styles.css                - Dependency onboarding progress/step styling
```

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨
