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

## Troubleshooting

- **Worktrees not found**: The system now automatically uses your home directory. If you have worktrees elsewhere, set `WORKTREE_BASE_PATH` in `.env`
- **Permission errors**: Make sure all `.sh` scripts are executable: `chmod +x *.sh`
- **Claude CLI not found**: Install with `npm install -g @anthropic-ai/claude-cli`

## Environment Variables

The system supports these environment variables (defaults apply when unset):

- `WORKTREE_BASE_PATH`: Base directory for worktrees (defaults to your home directory)
- `WORKTREE_COUNT`: Number of worktrees (defaults to 8)
- `ORCHESTRATOR_PORT`: Server port (defaults to 3000)
- `SESSION_TIMEOUT`: Session timeout in ms (defaults to 1800000 - 30 minutes)

## What Changed

Previously, paths were hardcoded to `/home/ab/`. Now:
- Server automatically uses your home directory
- All shell scripts use dynamic paths
- No .env file required unless you have a custom setup
