#!/bin/bash

echo "🔴 Stopping existing server on port 7655..."
# Find and kill process on port 7655
lsof -ti:7655 | xargs kill -9 2>/dev/null || echo "No server running on port 7655"

echo "⏳ Waiting for port to be free..."
sleep 2

echo "🚀 Starting diff viewer server..."
cd ${WORKTREE_BASE:-$HOME}/HyFire2-work1/claude-orchestrator/diff-viewer

# Build client if dist doesn't exist
if [ ! -d "client/dist" ]; then
    echo "📦 Building client (first time setup)..."
    cd client
    npm install
    npm run build
    cd ..
fi

# Start the server
echo "🟢 Starting server on port 7655..."
npm run dev