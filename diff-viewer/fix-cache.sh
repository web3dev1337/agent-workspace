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
DIFF_VIEWER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIFF_VIEWER_DIR"
rm -f cache/diffs.db
echo "✅ Cache cleared!"
echo ""

# Step 3: Restart server
echo "3️⃣ Starting server..."
npm run dev &
echo ""
echo "✅ Server started!"
echo ""

echo "4️⃣ Wait 5 seconds, then refresh your browser at:"
echo "   http://localhost:7655/pr/OWNER/REPO/PR_NUMBER"
echo ""
echo "The analysis will be regenerated with the advanced semantic engine!"
