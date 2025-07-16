#!/bin/bash

echo "🚀 Starting Advanced Diff Viewer..."

# Navigate to diff-viewer directory
cd /home/ab/HyFire2-work1/claude-orchestrator/diff-viewer

# Build client if dist doesn't exist
if [ ! -d "client/dist" ]; then
  echo "📦 Building client..."
  cd client
  npm install
  npm run build
  cd ..
  echo "✅ Client built successfully!"
fi

# Install server dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing server dependencies..."
  npm install
fi

echo "🎯 Starting server on port 7655..."
echo "📋 Access the diff viewer at: http://localhost:7655"
echo ""
echo "To test, open a URL like:"
echo "http://localhost:7655/pr/facebook/react/27000"
echo ""

# Start the server
npm run dev