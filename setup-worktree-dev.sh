#!/bin/bash

# Setup git worktree for Claude Orchestrator development
# This creates a worktree that can run alongside production

echo "Setting up Claude Orchestrator development worktree..."

WORKTREE_DIR="$HOME/claude-orchestrator-dev"
CURRENT_BRANCH=$(git branch --show-current)

# Create worktree
echo "Creating worktree at $WORKTREE_DIR..."
git worktree add "$WORKTREE_DIR" -b dev/orchestrator-updates origin/main

cd "$WORKTREE_DIR"

# Create .env with different ports
cat > .env << 'EOF'
# Development worktree ports
PORT=4000
CLIENT_PORT=2081
TAURI_DEV_PORT=1421

# Point to same HyFire2 worktrees
WORKTREE_BASE_PATH=~/HyFire2
WORKTREE_COUNT=8

# Different session prefix to avoid conflicts
SESSION_PREFIX=dev

# Optional: Different log directory
LOG_DIR=logs-dev
EOF

# Update package.json to use different ports
cat > update-ports.js << 'SCRIPT'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Update dev scripts to use different ports
if (pkg.scripts) {
    // Update client dev server port
    pkg.scripts['dev:client'] = 'PORT=2081 node client/dev-server.js';

    // Update any other scripts that might conflict
    if (pkg.scripts['tauri:dev']) {
        pkg.scripts['tauri:dev'] = 'TAURI_DEV_SERVER_PORT=1421 tauri dev';
    }
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Updated package.json with development ports');
SCRIPT

node update-ports.js
rm update-ports.js

# Install dependencies
npm install

# Create convenience script
cat > run-dev.sh << 'SCRIPT'
#!/bin/bash

echo "🚀 Starting Development Orchestrator"
echo "   Server: http://localhost:4000"
echo "   Client: http://localhost:2081"
echo ""
echo "⚠️  This is the DEVELOPMENT instance - safe to modify!"
echo ""

# Ensure we're using dev ports
export PORT=4000
export CLIENT_PORT=2081
export TAURI_DEV_SERVER_PORT=1421

npm run dev:all
SCRIPT

chmod +x run-dev.sh

echo "✅ Development worktree ready!"
echo ""
echo "Usage:"
echo "  cd $WORKTREE_DIR"
echo "  ./run-dev.sh"
echo ""
echo "Your production Orchestrator remains at: $(pwd)"
echo "Development instance will run at: $WORKTREE_DIR"
echo ""
echo "Port mapping:"
echo "  Production → Development"
echo "  3000       → 4000  (server)"
echo "  2080       → 2081  (client)"
echo "  1420       → 1421  (tauri)"