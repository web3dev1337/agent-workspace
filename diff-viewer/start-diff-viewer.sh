#!/bin/bash

echo "🚀 Starting Advanced Diff Viewer..."

# Navigate to this script's directory (diff-viewer/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build client if dist doesn't exist OR is stale vs client sources
DIST_INDEX="client/dist/index.html"
NEEDS_BUILD="false"

if [ ! -f "$DIST_INDEX" ]; then
  NEEDS_BUILD="true"
else
  # Rebuild if any source file is newer than the last built dist/index.html
  if find client/src client/index.html client/package.json client/vite.config.* -type f -newer "$DIST_INDEX" -print -quit 2>/dev/null | grep -q .; then
    NEEDS_BUILD="true"
  fi
fi

if [ "$NEEDS_BUILD" = "true" ]; then
  echo "📦 Building client..."
  (cd client && npm install && npm run build)
  echo "✅ Client built successfully!"
fi

# Install server dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing server dependencies..."
  npm install
fi

PORT="${DIFF_VIEWER_PORT:-9462}"

echo "🎯 Starting server on port ${PORT}..."
echo "📋 Access the diff viewer at: http://localhost:${PORT}"
echo ""
echo "To test, open a URL like:"
echo "http://localhost:${PORT}/pr/facebook/react/27000"
echo ""

# Start the server
npm run dev
