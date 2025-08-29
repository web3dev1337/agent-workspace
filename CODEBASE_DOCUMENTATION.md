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
```

### Client → Server Events
```
create-session: {type, config}                 - Request new session
destroy-session: {sessionId}                   - Close session
terminal-input: {sessionId, input}             - Send input to terminal
request-status: {}                             - Request status update
git-command: {command, args}                   - Execute git command
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

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨