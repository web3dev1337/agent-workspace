#!/bin/bash
# Install Agent Workspace startup shortcuts

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_DIR="$(dirname "$SCRIPT_DIR")"
BIN_PATH="$HOME/.local/bin/orchestrator"
DESKTOP_FILE="$HOME/Desktop/Agent-Workspace.desktop"
APPLICATIONS_FILE="$HOME/.local/share/applications/agent-workspace.desktop"

echo -e "${BLUE}🚀 Installing Agent Workspace startup shortcuts...${NC}"

# Ensure ~/.local/bin exists
mkdir -p ~/.local/bin
mkdir -p ~/.local/share/applications

# Copy startup script to bin
echo -e "${BLUE}📋 Installing command-line shortcut...${NC}"
cp "$SCRIPT_DIR/orchestrator-startup.sh" "$BIN_PATH"
chmod +x "$BIN_PATH"

# Create desktop shortcut
echo -e "${BLUE}🖥️ Creating desktop shortcut...${NC}"
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Agent Workspace
Comment=Multi-workspace development environment for Claude Code
Exec=$BIN_PATH
Icon=$ORCHESTRATOR_DIR/client/icon.png
Terminal=false
Categories=Development;IDE;
StartupWMClass=agent-workspace
EOF

chmod +x "$DESKTOP_FILE"

# Copy to applications menu
cp "$DESKTOP_FILE" "$APPLICATIONS_FILE"

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database ~/.local/share/applications/ 2>/dev/null || true
fi

echo -e "${GREEN}✅ Installation complete!${NC}"
echo -e ""
echo -e "${BLUE}📌 Available shortcuts:${NC}"
echo -e "  ${GREEN}Command line:${NC} orchestrator"
echo -e "  ${GREEN}Desktop:${NC} Click 'Agent Workspace' icon"
echo -e "  ${GREEN}Applications:${NC} Search for 'Agent Workspace'"
echo -e ""
echo -e "${BLUE}💡 Usage:${NC}"
echo -e "  orchestrator              # Start with auto-update"
echo -e "  orchestrator --no-update  # Start without git pull"
echo -e ""
echo -e "${YELLOW}🚀 Ready to launch! Run 'orchestrator' to start${NC}"
