# Co-worker Setup Guide

This guide helps you set up the Claude Orchestrator on your machine.

## Quick Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/web3dev1337/claude-orchestrator.git
   cd claude-orchestrator
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create worktrees in your home directory**
   ```bash
   cd ~/
   for i in {1..8}; do
     git worktree add HyFire2-work$i
   done
   ```

4. **Optional: Create .env file**
   If your worktrees are NOT in your home directory, create a `.env` file:
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and set:
   ```
   WORKTREE_BASE_PATH=/path/to/your/worktrees
   ```

5. **Run environment check**
   ```bash
   ./check-environment.sh
   ```
   This will verify your setup and show any missing components.

6. **Start the orchestrator**
   ```bash
   npm start
   ```

## Diff Viewer Setup (Optional)

If you need the diff viewer:

1. **Navigate to diff-viewer**
   ```bash
   cd diff-viewer
   ```

2. **Create .env file**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your GitHub token:
   ```
   GITHUB_TOKEN=ghp_your_github_token_here
   ```

3. **Install and start**
   ```bash
   npm install
   ./start-diff-viewer.sh
   ```

## Windows Setup (Git Bash)

For Windows users using Git Bash, additional setup is required:

### Prerequisites

1. **Visual Studio Build Tools 2022**
   - Download from: https://aka.ms/vs/17/release/vs_buildtools.exe
   - During installation, select:
     - ✅ "Desktop development with C++" workload
     - ✅ MSVC v143 - VS 2022 C++ x64/x86 build tools
     - ✅ Windows 11 SDK (or Windows 10 SDK)
   - Total download: ~2-3 GB

2. **Rust (for Tauri)**
   - Download from: https://win.rustup.rs/x86_64
   - Run the installer (it will auto-detect VS Build Tools)
   - Restart your terminal after installation

### Windows-Specific Steps

1. **Clone and setup**
   ```bash
   git clone https://github.com/web3dev1337/claude-orchestrator.git
   cd claude-orchestrator
   ```

2. **Create HyFire2 worktrees**
   ```bash
   # Navigate to your HyFire2 repository
   cd GitHub/HyFire2
   
   # Create 8 worktrees in your home directory
   for i in {1..8}; do
     git worktree add ~/HyFire2-work$i
   done
   
   # Update each worktree to latest master
   for i in {1..8}; do
     cd ~/HyFire2-work$i && git pull origin master
   done
   ```

3. **Install dependencies**
   ```bash
   cd ~/GitHub/claude-orchestrator
   npm install
   ```

4. **If port 3000 is in use, create .env file**
   ```bash
   echo "PORT=3001" > .env
   ```

5. **Start the application**
   ```bash
   npm run dev
   ```

### Windows Limitations

- The application uses a mock PTY implementation on Windows
- Terminal functionality is limited compared to WSL/Linux
- For full functionality, consider using WSL2

### Troubleshooting Windows Issues

- **node-pty build fails**: This is expected on Windows. The app will use the mock PTY fallback
- **Port already in use**: Create `.env` file with `PORT=3001` or another free port
- **Rust not found after install**: Restart your Git Bash terminal
- **VS Build Tools not detected**: Ensure you selected the C++ workload during installation

## General Troubleshooting

- **Worktrees not found**: The system now automatically uses your home directory. If you have worktrees elsewhere, set `WORKTREE_BASE_PATH` in `.env`
- **Permission errors**: Make sure all `.sh` scripts are executable: `chmod +x *.sh`
- **Claude CLI not found**: Install with `npm install -g @anthropic-ai/claude-cli`

## Environment Variables

The system supports these environment variables (all optional):

- `WORKTREE_BASE_PATH`: Base directory for worktrees (defaults to your home directory)
- `WORKTREE_COUNT`: Number of worktrees (defaults to 8)
- `PORT`: Server port (defaults to 3000)
- `SESSION_TIMEOUT`: Session timeout in ms (defaults to 1800000 - 30 minutes)

## What Changed

Previously, paths were hardcoded to `/home/<user>/`. Now:
- Server automatically uses your home directory
- All shell scripts use dynamic paths
- No .env file required unless you have a custom setup