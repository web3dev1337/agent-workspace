#!/bin/bash

# Setup script for development instance of Claude Orchestrator
# This creates a separate instance that won't conflict with production

echo "Setting up Claude Orchestrator development instance..."

# Clone to a separate directory
DEV_DIR="$HOME/claude-orchestrator-dev"

if [ -d "$DEV_DIR" ]; then
    echo "Dev directory already exists. Remove it first if you want to start fresh."
    exit 1
fi

# Clone the repo
git clone https://github.com/web3dev1337/claude-orchestrator.git "$DEV_DIR"
cd "$DEV_DIR"

# Create .env with different ports
cat > .env << 'EOF'
# Development instance ports (different from production)
PORT=4000
CLIENT_PORT=2081
TAURI_DEV_PORT=1421

# Point to same worktrees (or different ones if you prefer)
WORKTREE_BASE_PATH=~/HyFire2
WORKTREE_COUNT=8

# Optional: Use different log directory
LOG_DIR=logs-dev
EOF

# Install dependencies
npm install

# Create a dev-specific start script
cat > start-dev.sh << 'SCRIPT'
#!/bin/bash
echo "Starting development Orchestrator on ports:"
echo "  Server: 4000"
echo "  Client: 2081"
echo "  Tauri: 1421"
npm run dev:all
SCRIPT

chmod +x start-dev.sh

echo "✅ Development instance ready!"
echo ""
echo "Usage:"
echo "  cd $DEV_DIR"
echo "  ./start-dev.sh"
echo ""
echo "This instance runs on different ports and won't conflict with your main Orchestrator."