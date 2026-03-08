# Claude Orchestrator Setup Instructions

## Prerequisites

### 1. Install Node.js (16+)
Make sure you have Node.js installed:
```bash
node --version  # Should be 16.0.0 or higher
```

### 2. Install Rust
Required for building the native Tauri app:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 3. Install System Dependencies (Linux)
Tauri requires GTK/WebKit libraries on Linux:
```bash
sudo apt update && sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libgtk-3-dev \
    libjavascriptcoregtk-4.1-dev \
    pkg-config
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/web3dev1337/claude-orchestrator.git
cd claude-orchestrator
```

2. Install Node dependencies:
```bash
npm install
```

## Running the Application

### Option 1: Run Everything (Recommended)
```bash
npm run dev:all
```
This starts:
- Backend server (port 3000)
- Client dev server (port 8080)
- Tauri native window

### Option 2: Run Components Separately
```bash
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Client
npm run dev:client

# Terminal 3 - Tauri
npm run tauri:dev
```

## Building for Production

Build the native executable:
```bash
npm run tauri:build
```

The built app will be in:
- **Linux**: `src-tauri/target/release/claude-orchestrator`
- **Windows**: `src-tauri/target/release/claude-orchestrator.exe`
- **macOS**: `src-tauri/target/release/bundle/macos/Claude Orchestrator.app`

## Troubleshooting

### "Rust not found"
```bash
source $HOME/.cargo/env
```

### "Port already in use"
```bash
pkill -f "node server"
```

### Build errors on Linux
Make sure all system dependencies are installed (see Prerequisites section).

### "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

## Features

- **Native Performance**: 10-20x faster startup than browser
- **System Tray**: Minimize to tray, always accessible
- **Global Hotkeys**: Ctrl+Shift+O to show/focus window
- **16 Terminal Grid**: 8 Claude sessions + 8 server terminals
- **Real-time Updates**: Socket.IO powered terminal streaming

## Development Notes

- Frontend connects to `http://localhost:3000` for Socket.IO
- Tauri serves files from the `client/` directory
- Native features implemented in Rust (`src-tauri/src/main.rs`)
- Existing Node.js backend remains unchanged