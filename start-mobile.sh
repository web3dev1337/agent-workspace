#!/bin/bash

# Kill any existing servers
pkill -f "node.*orchestrator" || true

# Start orchestrator with explicit binding
echo "Starting orchestrator for mobile access..."

# Require an auth token when binding to non-loopback (safer for LAN use).
AUTH_TOKEN="${AUTH_TOKEN:-$(python3 - <<'PY'\nimport secrets\nprint(secrets.token_urlsafe(24))\nPY\n)}"

ORCHESTRATOR_PORT=8888 ORCHESTRATOR_HOST=0.0.0.0 AUTH_TOKEN="$AUTH_TOKEN" npm start &

sleep 3

echo ""
echo "========================================="
echo "ORCHESTRATOR READY FOR MOBILE ACCESS!"
echo "========================================="
echo ""
echo "1. Make sure your PC's mobile hotspot is ON"
echo "2. Connect your phone to the PC hotspot"
echo "3. On your phone browser, go to:"
echo ""
echo "   http://192.168.137.1:8888/?token=$AUTH_TOKEN"
echo ""
echo "========================================="
echo ""
echo "Press Ctrl+C to stop"

# Keep script running
wait
