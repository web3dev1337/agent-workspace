#!/bin/bash

echo "🔄 FULL RESTART SCRIPT"
echo "===================="
echo ""

# Run relative to this script so paths are portable.
DIFF_VIEWER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kill any existing processes
echo "1️⃣ Killing existing processes..."
pkill -f "node.*server/index.js" || true
pkill -f "vite" || true
sleep 2

# Clear all caches
echo "2️⃣ Clearing all caches..."
cd "$DIFF_VIEWER_DIR"
rm -f cache/diffs.db
rm -rf .cache
rm -rf node_modules/.cache

# Rebuild client
echo "3️⃣ Rebuilding client..."
cd client
npm run build

# Start server
echo "4️⃣ Starting server..."
cd ..
npm run dev &

echo ""
echo "✅ DONE! Server is starting..."
echo ""
echo "Wait 5 seconds, then access:"
echo "http://localhost:7655/pr/OWNER/REPO/PR_NUMBER"
echo ""
echo "Check the server output above for analysis logs!"
