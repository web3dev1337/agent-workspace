# Claude Orchestrator

A comprehensive toolkit for managing Claude Code sessions with multiple features including a native desktop app and advanced diff viewer.

## Features

### 🖥️ Native Desktop App (Tauri)
A high-performance native application for managing multiple Claude Code sessions:
- **16 Terminal Grid**: 8 Claude sessions + 8 server terminals
- **Native Performance**: 10-20x faster startup, 75% less memory
- **System Integration**: Tray icon, notifications, global hotkeys
- **Real-time Updates**: Socket.IO powered terminal streaming

### 🔍 Advanced Diff Viewer
A sophisticated web-based tool for code review and analysis:
- **GitHub Integration**: View PRs, commits, and diffs
- **AST Analysis**: Semantic understanding of code changes
- **AI Summaries**: Automatic risk detection and insights
- **Multiple Export**: PDF, Markdown, and sharing options

## Quick Start

### Running the Native App

```bash
# Install dependencies
npm install

# Run all services (recommended)
npm run dev:all

# Or run individually:
npm run dev        # Backend server
npm run tauri:dev  # Native app
```

### Running the Diff Viewer

```bash
# Start the diff viewer
cd diff-viewer
npm install
npm start

# Or use the convenience script
./start-diff-viewer.sh
```

## Architecture

```
claude-orchestrator/
├── client/              # Tauri app frontend
├── server/             # Node.js backend
├── src-tauri/          # Rust native code
├── diff-viewer/        # Advanced diff viewer
│   ├── client/         # React frontend
│   └── server/         # Express backend
└── package.json        # Root dependencies
```

## Performance (Native App)

| Metric | Browser | Tauri Native |
|--------|---------|--------------|
| Startup | 2-5s | 200-500ms |
| Memory | 600MB+ | 150-300MB |
| Latency | 50-150ms | 15-50ms |

## Documentation

- [Installation Guide](INSTALL_DIFF_VIEWER.md)
- [Diff Viewer Features](DIFF_VIEWER_FEATURES.md)
- [Implementation Notes](IMPLEMENTATION_NOTES.md)
- [Usage Guide](USAGE_CLARIFICATION.md)

## Development

### Prerequisites
- Node.js 16+
- Rust (for Tauri app)
- Git

### Building for Production

```bash
# Build Tauri app
npm run tauri:build

# Build diff viewer
cd diff-viewer && npm run build
```

## Future Roadmap

### Native App (Phase 2)
- Port terminal management to Rust
- Native file watching
- Auto-update functionality
- Direct WSL integration

### Diff Viewer
- Real-time collaboration
- More language support
- Enhanced AI insights
- Performance optimizations

## License

MIT License - see LICENSE file for details