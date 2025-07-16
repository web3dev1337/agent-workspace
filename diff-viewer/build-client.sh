#!/bin/bash

echo "Building diff-viewer client..."

cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer/client

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing client dependencies..."
  npm install
fi

# Build for production
echo "Building production bundle..."
npm run build

echo "Build complete! The client is ready."