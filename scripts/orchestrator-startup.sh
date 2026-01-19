#!/bin/bash
# Claude Orchestrator One-Click Startup Script

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ORCHESTRATOR_DIR="/home/ab/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev"
export ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT:-4000}"
CLIENT_PORT=2080

echo -e "${BLUE}🚀 Claude Orchestrator Startup${NC}"
echo -e "${BLUE}================================${NC}"

# Check if already running
if lsof -i:$CLIENT_PORT >/dev/null 2>&1; then
  echo -e "${GREEN}✅ Orchestrator already running${NC}"
  echo -e "${BLUE}Opening browser...${NC}"

  # Just open browser
  if command -v xdg-open >/dev/null; then
    xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &
  elif command -v open >/dev/null; then
    open "http://localhost:$CLIENT_PORT"
  fi

  echo -e "${GREEN}🎉 Claude Orchestrator ready at http://localhost:$CLIENT_PORT${NC}"
  exit 0
fi

# Navigate to orchestrator
cd "$ORCHESTRATOR_DIR" || {
  echo -e "${RED}❌ Orchestrator directory not found: $ORCHESTRATOR_DIR${NC}"
  exit 1
}

# Optional: Update to latest (can be disabled with --no-update flag)
if [[ "$1" != "--no-update" ]]; then
  echo -e "${BLUE}📥 Checking for updates...${NC}"
  git fetch origin feature/multi-workspace-system >/dev/null 2>&1 || true

  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  REMOTE=$(git rev-parse origin/feature/multi-workspace-system 2>/dev/null || echo "unknown")

  if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "unknown" ]; then
    echo -e "${BLUE}⬇️ Pulling updates...${NC}"
    git pull origin feature/multi-workspace-system 2>/dev/null || echo -e "${YELLOW}⚠ Could not pull (offline?)${NC}"

    # Update dependencies if package.json changed
    if git diff --name-only HEAD~1..HEAD 2>/dev/null | grep -q package.json; then
      echo -e "${BLUE}📦 Updating dependencies...${NC}"
      npm install >/dev/null 2>&1 || echo -e "${YELLOW}⚠ Could not update deps${NC}"
    fi
  else
    echo -e "${GREEN}✅ Already up to date${NC}"
  fi
fi

# Ensure workspace system is set up
echo -e "${BLUE}🔧 Setting up workspace system...${NC}"
if [ ! -d ~/.orchestrator ]; then
  echo -e "${BLUE}📁 Creating workspace directories...${NC}"
  node scripts/migrate-to-workspaces.js >/dev/null 2>&1 || {
    echo -e "${RED}❌ Failed to set up workspace system${NC}"
    exit 1
  }
  echo -e "${GREEN}✅ Workspace system initialized${NC}"
fi

# Start services in background
echo -e "${BLUE}🔧 Starting orchestrator services...${NC}"
npm run dev:all >/dev/null 2>&1 &
ORCH_PID=$!

# Wait for services to be ready (check client port)
echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
TIMEOUT=30
ELAPSED=0
while ! lsof -i:$CLIENT_PORT >/dev/null 2>&1; do
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))

  if [ $ELAPSED -gt $((TIMEOUT * 2)) ]; then
    echo -e "${RED}❌ Timeout waiting for services${NC}"
    kill $ORCH_PID 2>/dev/null
    exit 1
  fi

  # Show progress dots
  if [ $((ELAPSED % 4)) -eq 0 ]; then
    echo -n "."
  fi
done

echo -e "\n${GREEN}✅ Services ready!${NC}"

# Open browser automatically
echo -e "${BLUE}🌐 Opening orchestrator...${NC}"
sleep 1

if command -v xdg-open >/dev/null; then
  xdg-open "http://localhost:$CLIENT_PORT" >/dev/null 2>&1 &
elif command -v open >/dev/null; then
  open "http://localhost:$CLIENT_PORT"
fi

echo -e "${GREEN}🎉 Claude Orchestrator ready at http://localhost:$CLIENT_PORT${NC}"
echo -e "${BLUE}💡 Press Ctrl+C to stop services${NC}"
echo -e "${BLUE}💡 Run with --no-update to skip git pull${NC}"

# Keep script running to show it's active
wait $ORCH_PID
