#!/bin/bash

echo "🧹 Clearing diff viewer cache..."

# Remove the SQLite cache database
DIFF_VIEWER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -f "$DIFF_VIEWER_DIR/cache/diffs.db"

echo "✅ Cache cleared!"
echo ""
echo "The server will recreate the cache database when you access the PR again."
echo "This will force it to re-analyze the files with the new advanced engine."
echo ""
echo "Now refresh your browser at: http://localhost:9462/pr/OWNER/REPO/PR_NUMBER"
