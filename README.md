# Claude Orchestrator

A web-based multi-terminal orchestrator for managing multiple Claude Code sessions in parallel with an advanced git diff viewer. Built specifically for developers running multiple AI coding agents simultaneously.

![Status](https://img.shields.io/badge/Phase-MVP%20Complete-green)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## 🚀 Features

### Terminal Orchestrator
- **16 Terminal Dashboard**: 8 Claude AI + 8 server terminals in one view
- **Real-time Status Tracking**: Visual indicators (🟢 ready / 🟡 busy / 🔴 waiting)
- **Smart Notifications**: Browser alerts when Claude needs your input
- **Git Integration**: Shows current branch for each worktree
- **Quick Actions**: One-click Yes/No responses for Claude prompts
- **Code Review Assignment**: Assign PRs to other Claude instances for review
- **Activity Filtering**: Show/hide inactive sessions

### Advanced Diff Viewer (New!)
- **Semantic Diffs**: AST-based analysis reduces noise by 30%
- **AI-Powered Summaries**: Intelligent code review with risk detection
- **Monaco Editor**: VS Code-like diff viewing experience
- **Export Options**: Save diffs as PDF or Markdown
- **Real-time Collaboration**: WebSocket-powered cursor sharing
- **Persistent Caching**: SQLite-backed GitHub API cache
- **One-Click Launch**: Direct access from detected GitHub URLs

## 📸 Screenshots

```
┌─────────────────────────────────────────────────────────┐
│ Claude Orchestrator          Active: 3  Waiting: 1  Idle: 4 │
├─────────────────────────────────────────────────────────┤
│ ┌─ Worktree 1 ─────────────────────────────────────┐   │
│ │ Claude AI (feature-auth) 🟡 │ Server (feature-auth) │ │
│ │ [Terminal Output]          │ [Terminal Output]     │ │
│ └───────────────────────────┴───────────────────────┘ │
│ ┌─ Worktree 2 ─────────────────────────────────────┐   │
│ │ Claude AI (fix-memory) 🔴   │ Server (fix-memory)   │ │
│ │ [Terminal Output]          │ [Terminal Output]     │ │
│ │ [Yes] [No]                 │                       │ │
│ └───────────────────────────┴───────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 🎯 Quick Start

### Prerequisites
- Node.js 16+
- Claude CLI installed (`claude --version`)
- Git worktrees set up (work1-work8)

### Installation

```bash
# Clone the repository
cd /home/ab/HyFire2-work1/claude-orchestrator

# Run the installer
./install.sh

# Or manually:
npm install
cp .env.example .env
```

### Running

```bash
# Check your environment first
./check-environment.sh

# If bun is not in PATH, add it:
export PATH=/snap/bin:$PATH

# Setup Claude hooks for better notifications (optional but recommended)
./setup-claude-hooks.sh

# Start the orchestrator
npm start

# Access the dashboard
# Orchestrator: http://localhost:3000
# Diff Viewer:  http://localhost:7655
# LAN Access:   http://192.168.1.x:3000

# Or start diff viewer separately:
cd diff-viewer
./start.sh
```

### First Time Setup

1. **Enable Notifications**: Click the bell icon and allow browser notifications
2. **Configure Worktrees**: Edit `.env` if your worktrees are in a different location
3. **Set Authentication** (optional): Add `AUTH_TOKEN=your-secret` to `.env`

## Project Structure

```
claude-orchestrator/
├── server/               # Backend Node.js server
│   ├── index.js         # Main Express server
│   ├── sessionManager.js # PTY process management
│   ├── statusDetector.js # Claude state detection
│   └── gitHelper.js     # Git branch detection
├── client/              # Frontend web dashboard
│   ├── index.html       # Main dashboard UI
│   ├── app-new.js       # Client orchestration
│   └── styles-new.css   # Dashboard styling
├── diff-viewer/         # Advanced diff viewer
│   ├── server/          # Express + WebSocket backend
│   │   ├── api/         # REST endpoints
│   │   ├── cache/       # SQLite caching
│   │   └── diff-engine/ # AST-based analysis
│   └── client/          # React + Monaco frontend
│       ├── src/         # React components
│       └── vite.config.js # Build configuration
├── logs/                # Session logs (gitignored)
└── sessions/            # Session state (gitignored)
```

## Security

- **Local-only by default**: No external API calls or cloud services
- **Optional authentication**: Set AUTH_TOKEN in .env to enable
- **Process isolation**: Resource limits and timeouts for each session
- **Secure logging**: Sensitive data is automatically redacted

## Browser Requirements

- Modern browser with WebSocket support
- JavaScript enabled
- For notifications: Permission must be granted when prompted

## Development

This project uses:
- **Backend**: Node.js + Express + Socket.IO
- **Terminal handling**: node-pty
- **Frontend**: Vanilla JS + Xterm.js
- **Real-time communication**: WebSockets

## 🔧 Troubleshooting

### Common Issues

**Cannot connect to Claude**
- Ensure Claude CLI is installed: `claude --version`
- Check worktree paths exist: `ls /home/ab/HyFire2-work*`
- Verify no other processes are using the Claude sessions

**Notifications not working**
- Click the bell icon and allow browser notifications
- Check browser settings for notification permissions
- Ensure HTTPS if accessing remotely

**Authentication issues**
- Token in URL: `http://localhost:3000?token=your-token`
- Token persists in browser after first use

### Debug Mode
```bash
# Enable debug logging
echo "LOG_LEVEL=debug" >> .env
npm start

# Check logs
tail -f logs/combined.log
```

## 🚧 Roadmap

### ✅ Phase 1: MVP (Complete)
- Multi-terminal dashboard
- Real-time status tracking
- Browser notifications
- Git branch display
- Session management

### 🚧 Phase 2: Enhanced Monitoring (In Progress)
- Token usage tracking
- Advanced status detection
- Session history & logs
- Performance optimizations
- Mobile UI improvements

### 📋 Phase 3: Orchestration (Planned)
- Task queue system
- Multi-agent coordination
- Automated git operations
- Result comparison dashboard
- AI agent communication

## 🤝 Contributing

Contributions are welcome! Please check the issues page or submit a PR.

## 📚 Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for detailed technical documentation.

## License

MIT