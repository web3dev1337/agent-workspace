#!/bin/bash

echo "🧹 Clearing diff viewer cache..."

# Remove the SQLite cache database
rm -f ${WORKTREE_BASE:-$HOME}/HyFire2-work1/claude-orchestrator/diff-viewer/server/cache/diff-cache.db

echo "✅ Cache cleared!"
echo ""
echo "The server will recreate the cache database when you access the PR again."
echo "This will force it to re-analyze the files with the new advanced engine."
echo ""
echo "Now refresh your browser at: http://localhost:7655/pr/NeuralPixelGames/HyFire2/925"