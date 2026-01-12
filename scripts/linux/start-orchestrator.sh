#!/bin/bash
# ============================================
# Claude Orchestrator - Linux Startup Script
# ============================================
# This script starts the orchestrator and opens the browser.
#
# Install via: scripts/linux/install-startup.sh
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT="${ORCHESTRATOR_PORT:-3000}"

echo "Starting Claude Orchestrator..."
echo "  Path: $REPO_ROOT"
echo "  Port: $PORT"
echo ""

cd "$REPO_ROOT"

# Start the server in background
npm start &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
for i in {1..30}; do
    if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
        echo "Server is ready!"
        break
    fi
    sleep 1
done

# Open browser
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:$PORT"
elif command -v open &> /dev/null; then
    open "http://localhost:$PORT"
fi

echo ""
echo "Orchestrator running! (PID: $SERVER_PID)"
echo "Press Ctrl+C to stop."

# Wait for server
wait $SERVER_PID
