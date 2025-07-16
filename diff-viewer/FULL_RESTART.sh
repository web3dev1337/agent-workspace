#!/bin/bash

echo "🔄 FULL RESTART SCRIPT"
echo "===================="
echo ""

# Kill any existing processes
echo "1️⃣ Killing existing processes..."
pkill -f "node.*server/index.js" || true
pkill -f "vite" || true
sleep 2

# Clear all caches
echo "2️⃣ Clearing all caches..."
cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer
rm -f server/cache/diff-cache.db
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
echo "http://localhost:7655/pr/NeuralPixelGames/HyFire2/925"
echo ""
echo "Check the server output above for analysis logs!"