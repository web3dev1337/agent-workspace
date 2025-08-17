#!/usr/bin/env bash
set -euo pipefail

# Portable launcher for Claude Orchestrator
# - Ensures dependencies
# - Starts server
# - Waits for /health
# - Opens browser
# - Ctrl+C cleanly stops the server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

cd "${REPO_DIR}"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi

echo "Starting server..."
npm start &
SERVER_PID=$!

cleanup() {
  echo
  echo "Stopping server (pid ${SERVER_PID})..."
  if kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill -INT "${SERVER_PID}" || true
    wait "${SERVER_PID}" || true
  fi
}
trap cleanup INT TERM

echo "Waiting for server at ${URL}..."
for i in $(seq 1 120); do
  if curl -fsS "${URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Open the browser (WSL/Linux/macOS fallbacks)
if command -v wslview >/dev/null 2>&1; then
  wslview "${URL}" || true
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe /c start "${URL}" || true
elif command -v cmd.exe >/dev/null 2>&1; then
  cmd.exe /c start "${URL}" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "${URL}" || true
fi

echo "Server is running. Press Ctrl+C to stop."
wait "${SERVER_PID}"


