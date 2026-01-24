# Agent Orchestrator Documentation (repo: `claude-orchestrator`)

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [Features](#features)
7. [Security](#security)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)
10. [Development](#development)

## Overview

Agent Orchestrator is a web-based multi-terminal management system for running multiple AI coding agent sessions in parallel (Claude Code, Codex, etc.). It provides real-time monitoring, status tracking, and unified control over multiple agent terminals.

> Note: the repository is still named `claude-orchestrator` for historical reasons. The UI/product name is **Agent Orchestrator**.

### Key Features
- **16 Terminal Dashboard**: 8 Claude + 8 server terminals
- **Real-time Status Tracking**: Visual indicators for idle/busy/waiting states
- **Smart Notifications**: Browser alerts when Claude needs input
- **Git Integration**: Shows current branch for each worktree
- **Local Network Access**: Secure access from any device on your LAN
- **Token Usage Tracking**: Monitor context window usage
- **Session Management**: Restart, monitor, and control sessions

## Architecture

### Backend (Node.js)
- **Express Server**: HTTP server and static file serving
- **Socket.IO**: Real-time bidirectional communication
- **node-pty**: Pseudo-terminal process management
- **Service Architecture**:
  - `SessionManager`: Manages PTY processes and session lifecycle
  - `StatusDetector`: Detects Claude's state from output patterns
  - `GitHelper`: Handles git operations and branch detection
  - `NotificationService`: Manages alerts and notifications
  - `TokenCounter`: Tracks context usage (Phase 2)

### Frontend (Vanilla JS)
- **Xterm.js**: Terminal rendering and interaction
- **WebSocket Client**: Real-time updates
- **Service Architecture**:
  - `ClaudeOrchestrator`: Main application controller
  - `TerminalManager`: Handles Xterm.js instances
  - `NotificationManager`: Browser notifications and alerts

## Installation

### Prerequisites
- Node.js 16+ 
- Git
- Claude CLI installed and configured
- 8 git worktrees set up (HyFire2-work1 through HyFire2-work8)

### Quick Install
```bash
# Clone the repository
git clone <repository-url> claude-orchestrator
cd claude-orchestrator

# Run installation script
./install.sh

# Or manually:
npm install
cp .env.example .env
mkdir -p logs sessions
```

### Environment Configuration
Edit `.env` file:
```env
# Server
ORCHESTRATOR_PORT=3000
HOST=0.0.0.0

# Security (optional)
AUTH_TOKEN=your-secret-token

# Paths
WORKTREE_BASE_PATH=/home/ab
WORKTREE_COUNT=8

# Session settings
SESSION_TIMEOUT=1800000  # 30 minutes
MAX_PROCESSES_PER_SESSION=50

# Logging
LOG_LEVEL=info

# Token tracking
MAX_CONTEXT_TOKENS=200000
```

## Usage

### Starting the Server
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

### Accessing the Dashboard
- **Local**: http://localhost:3000
- **LAN**: http://<your-ip>:3000
- **With Auth**: http://localhost:3000?token=your-secret-token

### Dashboard Interface

#### Header
- **Statistics**: Shows active/waiting/idle Claude sessions
- **Notifications**: Bell icon with unread count
- **Settings**: Configure notifications, sounds, theme
- **Connection Status**: Shows server connection state

#### Terminal Grid
Each worktree shows:
- **Claude Terminal**: AI agent interface
- **Server Terminal**: For running game server
- **Branch Name**: Current git branch
- **Status Indicator**:
  - 🟢 Green: Idle/ready
  - 🟡 Yellow: Busy/processing
  - 🔴 Red: Waiting for input
  - ⚫ Gray: Exited/stopped

#### Quick Actions
When Claude is waiting for input:
- **Yes/No buttons**: Quick response buttons
- **Search**: Find text in terminal output

### Keyboard Shortcuts
- `Ctrl+Shift+F`: Search in terminal
- `Ctrl+C`: Copy selected text
- `Ctrl+V`: Paste text

## Features

### Phase 1 (MVP) ✅
- [x] Multi-terminal web dashboard
- [x] Real-time terminal streaming
- [x] Status detection (idle/busy/waiting)
- [x] Browser notifications
- [x] Git branch display
- [x] Quick action buttons
- [x] Session restart capability
- [x] Local network access
- [x] Optional authentication

### Phase 2 (Enhancements) 🚧
- [x] Token usage tracking (basic)
- [ ] Enhanced status detection
- [ ] Terminal search functionality
- [ ] Session logs export
- [ ] Performance optimizations
- [ ] Mobile-optimized layout

### Phase 3 (Orchestration) 📋
- [ ] Task queue system
- [ ] Multi-agent coordination
- [ ] Automated git operations
- [ ] Result comparison
- [ ] AI agent communication

## Security

### Authentication
Set `AUTH_TOKEN` in `.env` to enable authentication:
```env
AUTH_TOKEN=your-secret-token
```

Access methods:
1. URL parameter: `http://localhost:3000?token=your-secret-token`
2. Saved in browser (localStorage)
3. Header: `X-Auth-Token: your-secret-token`

### Security Features
- **Local-only by default**: No external API calls
- **Input validation**: Path traversal protection
- **Process isolation**: Resource limits per session
- **Secure logging**: Sensitive data redaction
- **Rate limiting**: Notification spam protection

### Best Practices
1. Always use authentication in shared environments
2. Bind to localhost only if not using LAN access
3. Use HTTPS with reverse proxy for remote access
4. Regularly update dependencies
5. Monitor logs for suspicious activity

## API Reference

### WebSocket Events

#### Client → Server
- `terminal-input`: Send input to terminal
  ```js
  socket.emit('terminal-input', { sessionId, data })
  ```
- `terminal-resize`: Resize terminal
  ```js
  socket.emit('terminal-resize', { sessionId, cols, rows })
  ```
- `restart-session`: Restart a session
  ```js
  socket.emit('restart-session', { sessionId })
  ```

#### Server → Client
- `sessions`: Initial session states
- `terminal-output`: Terminal output data
- `status-update`: Session status change
- `branch-update`: Git branch change
- `notification-trigger`: Notification event
- `session-exited`: Session terminated
- `session-restarted`: Session restarted

### REST Endpoints
- `GET /`: Dashboard UI
- `GET /health`: Health check
  ```json
  {
    "status": "ok",
    "timestamp": "2024-01-01T00:00:00Z",
    "uptime": 12345
  }
  ```

## Troubleshooting

### Common Issues

#### Cannot connect to server
1. Check if server is running: `ps aux | grep node`
2. Check firewall settings for port 3000
3. Verify HOST setting in .env

#### Terminals not displaying
1. Check browser console for errors
2. Verify WebSocket connection
3. Check if Claude CLI is installed

#### Authentication errors
1. Verify AUTH_TOKEN matches in .env and request
2. Clear browser cache/localStorage
3. Check server logs

#### High memory usage
1. Reduce terminal scrollback in code
2. Restart long-running sessions
3. Check for process leaks with `ps aux`

### Debug Mode
Enable verbose logging:
```env
LOG_LEVEL=debug
```

Check logs:
```bash
tail -f logs/combined.log
tail -f logs/sessions.log
tail -f logs/error.log
```

## Development

### Project Structure
```
claude-orchestrator/
├── server/              # Backend Node.js code
│   ├── index.js        # Main server
│   ├── sessionManager.js
│   ├── statusDetector.js
│   ├── gitHelper.js
│   ├── notificationService.js
│   └── tokenCounter.js
├── client/             # Frontend code
│   ├── index.html
│   ├── app.js
│   ├── terminal.js
│   ├── notifications.js
│   └── styles.css
├── logs/              # Log files (gitignored)
├── sessions/          # Session data (gitignored)
└── config/           # Configuration files
```

### Adding New Features

#### Backend Service
1. Create service in `server/`
2. Import in `server/index.js`
3. Initialize with dependencies
4. Add WebSocket handlers

#### Frontend Component
1. Create class in `client/`
2. Import in `index.html`
3. Initialize in `app.js`
4. Add event handlers

### Testing
```bash
# Run linting (when added)
npm run lint

# Manual testing
npm run dev
# Open multiple browser tabs
# Test all features
```

### Contributing
1. Fork the repository
2. Create feature branch
3. Make changes with clear commits
4. Test thoroughly
5. Submit pull request

## Performance Optimization

### Terminal Performance
- Limit scrollback buffer
- Throttle output updates
- Use virtual scrolling
- Batch DOM updates

### Network Optimization
- Compress WebSocket messages
- Batch status updates
- Use binary frames for large data
- Implement reconnection logic

### Resource Management
- Monitor memory usage
- Implement session pooling
- Auto-cleanup inactive sessions
- Use worker threads for heavy operations

## Extending the System

### Adding Custom Status Patterns
Edit `server/statusDetector.js`:
```javascript
this.waitingPatterns.push(/Your pattern here/i);
```

### Custom Notifications
Add to `server/notificationService.js`:
```javascript
notifyCustom(sessionId, message) {
  return this.notify(sessionId, 'custom', message, {
    priority: 'high',
    actionRequired: true
  });
}
```

### New Terminal Commands
Add keyboard shortcuts in `client/terminal.js`:
```javascript
if (e.ctrlKey && e.key === 'x') {
  // Your custom action
}
```

## License

MIT License - See LICENSE file for details
