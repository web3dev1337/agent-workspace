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
DIFF:       diff-viewer/                             - Advanced diff viewer component
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
└─ Uses: node-pty for terminal emulation

server/statusDetector.js           - Claude Code session monitoring
├─ Detects: Claude sessions, branch changes, status updates
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
server/tokenCounter.js             - Token usage tracking (if applicable)
server/userSettingsService.js      - User preferences and settings management
server/sessionRecoveryService.js   - Session recovery state persistence (CWD, agents, conversations)
```

### Multi-Workspace System (Core Feature)
```
server/workspaceManager.js          - Workspace lifecycle management
├─ Manages: Workspace creation, switching, mixed-repo support
├─ Features: Dynamic terminal creation, worktree integration
└─ Storage: JSON-based workspace persistence

server/workspaceSchemas.js          - Workspace configuration validation
├─ Schemas: JSON schema definitions for workspace types
└─ Validation: Ensures workspace integrity and structure

server/workspaceTypes.js            - Workspace type definitions
├─ Types: Single-repo, mixed-repo, custom configurations
└─ Templates: Default settings for different workspace types

server/worktreeHelper.js            - Git worktree operations wrapper
├─ Operations: Create, delete, manage git worktrees
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
├─ Methods: prefetchWorktreeConfigs(), fetchCascadedConfig()
├─ Cache: Map<sessionId, config> for worktree-specific configs
└─ Extract: extractRepositoryName() from workspace config
```

## Frontend Applications

### Web Client
```
client/app.js                      - Main client application
├─ Manages: UI state, socket connections, terminal grid
├─ Features: 16-terminal layout, real-time updates, session switching
└─ Dependencies: Socket.IO client, terminal emulation

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

client/workspace-tab-manager.js    - Multi-workspace tab management (NEW)
├─ Features: Browser-like tabs for multiple workspaces
├─ Manages: Tab creation, switching, state preservation
├─ XTerm lifecycle: Proper hide/show with fit() handling
├─ Notifications: Badge counts for inactive tabs
└─ Keyboard shortcuts: Ctrl+Tab, Ctrl+W, Ctrl+T, Ctrl+1-9

client/styles/tabs.css             - Tab bar styling
├─ Features: Tab UI, badges, animations
└─ Responsive: Mobile and desktop layouts
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
- Alt+← / Alt+→ to cycle tabs (previous/next)
- Alt+1-9 to jump to specific tab
- Alt+N for new workspace
- Alt+W to close current tab

```

### Native Desktop App (Tauri)
```
src-tauri/src/main.rs              - Tauri application entry point
├─ Features: Native performance, system integration, tray icon
├─ Commands: File operations, system notifications, window management
└─ Frontend: Rust backend + web frontend hybrid

src-tauri/src/terminal.rs          - Native terminal integration
src-tauri/src/file_watcher.rs      - Native file watching
src-tauri/src/lib.rs               - Tauri application library
```

### Configuration Files
```
src-tauri/tauri.conf.json          - Tauri app configuration
src-tauri/Cargo.toml               - Rust dependencies
config.json                        - Shared application configuration
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
```

## Development Workflow

### Project Scripts
```
npm run dev              - Start development server
npm run dev:client       - Start client dev server
npm run tauri:dev        - Start native app development
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
GET /api/user-settings            - Get user preferences
PUT /api/user-settings            - Update user preferences
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

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨
