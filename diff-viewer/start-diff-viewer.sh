#!/bin/bash

echo "🚀 Starting Advanced Diff Viewer..."

# Navigate to this script's directory (diff-viewer/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build client if dist doesn't exist
if [ ! -d "client/dist" ]; then
  echo "📦 Building client..."
  (cd client && npm install && npm run build)
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
