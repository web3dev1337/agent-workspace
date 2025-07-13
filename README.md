# Claude Orchestrator

A web-based multi-terminal orchestrator for managing multiple Claude Code sessions in parallel.

## Features

- **Multi-Terminal Dashboard**: View and interact with 16 terminals (8 Claude + 8 server) simultaneously
- **Real-time Status Tracking**: Visual indicators for idle/busy/waiting states
- **Smart Notifications**: Browser push notifications when Claude needs input
- **Git Branch Display**: Shows current branch for each worktree
- **Local Network Access**: Access from any device on your LAN
- **Security First**: No external dependencies, local-only by default

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start the server**:
   ```bash
   npm start
   # Or for development with auto-reload:
   npm run dev
   ```

4. **Access the dashboard**:
   - Local: http://localhost:3000
   - LAN: http://<your-ip>:3000

## Project Structure

```
claude-orchestrator/
├── server/           # Backend Node.js server
│   ├── index.js     # Main Express server
│   ├── sessionManager.js    # PTY process management
│   ├── statusDetector.js    # Claude state detection
│   ├── gitHelper.js         # Git branch detection
│   └── notificationService.js   # Notification handling
├── client/          # Frontend web dashboard
│   ├── index.html   # Main dashboard UI
│   ├── app.js       # Client orchestration
│   ├── terminal.js  # Xterm.js integration
│   └── styles.css   # Dashboard styling
├── config/          # Configuration files
├── logs/           # Session logs (gitignored)
└── sessions/       # Session state persistence (gitignored)
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

## License

MIT