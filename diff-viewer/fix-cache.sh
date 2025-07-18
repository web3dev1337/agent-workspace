#!/bin/bash

echo "🔧 Fixing the diff viewer cache issue..."
echo ""

# Step 1: Stop the server
echo "1️⃣ Stop the server with Ctrl+C in the terminal showing:"
echo "   '🔍 Diff Viewer running on http://localhost:7655'"
echo ""
echo "Press Enter when done..."
read

# Step 2: Clear the cache
echo "2️⃣ Clearing cache database..."
cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer
rm -f server/cache/diff-cache.db
echo "✅ Cache cleared!"
echo ""

# Step 3: Restart server
echo "3️⃣ Starting server..."
npm run dev &
echo ""
echo "✅ Server started!"
echo ""

echo "4️⃣ Wait 5 seconds, then refresh your browser at:"
echo "   http://localhost:7655/pr/NeuralPixelGames/HyFire2/925"
echo ""
echo "The analysis will be regenerated with the advanced semantic engine!"