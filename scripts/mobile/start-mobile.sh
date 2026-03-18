#!/bin/bash

set -euo pipefail

PORT="${ORCHESTRATOR_PORT:-8888}"
HOST="${ORCHESTRATOR_HOST:-0.0.0.0}"

if ss -ltn "( sport = :$PORT )" | tail -n +2 | grep -q .; then
  echo "Port $PORT is already in use. Stop the existing process or choose another ORCHESTRATOR_PORT."
  exit 1
fi

echo "Starting Agent Workspace for mobile access..."

AUTH_TOKEN="${AUTH_TOKEN:-$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)}"

ORCHESTRATOR_PORT="$PORT" ORCHESTRATOR_HOST="$HOST" AUTH_TOKEN="$AUTH_TOKEN" npm start &

sleep 3

echo ""
echo "========================================="
echo "AGENT WORKSPACE READY FOR MOBILE ACCESS"
echo "========================================="
echo ""
echo "1. Make sure your PC's mobile hotspot is ON"
echo "2. Connect your phone to the PC hotspot"
echo "3. On your phone browser, go to:"
echo ""
echo "   http://192.168.137.1:$PORT/?token=$AUTH_TOKEN"
echo ""
echo "========================================="
echo ""
echo "Press Ctrl+C to stop"

wait
