# Agent Workspace - One-Click Launcher for Windows
# Copy this file to your Windows Desktop for easy access
#
# This script will:
#   1. Open VS Code to the orchestrator folder in WSL
#   2. Auto-run 'npm start' via VS Code tasks
#   3. Open Chrome to http://localhost:3000

Write-Host "🚀 Launching Agent Workspace..." -ForegroundColor Cyan

# NOTE: Update the path below if your orchestrator is in a different location
# Default: /home/YOUR_USERNAME/GitHub/tools/automation/agent-workspace/master
& code --folder-uri "vscode-remote://wsl+Ubuntu/home/YOUR_USERNAME/GitHub/tools/automation/agent-workspace/master"

Write-Host "✅ VS Code launched!" -ForegroundColor Green
Write-Host "⏳ Server will auto-start in a few seconds..." -ForegroundColor Yellow
Write-Host "🌐 Opening browser to http://localhost:3000" -ForegroundColor Yellow

# Wait for server to start and open browser
Start-Sleep -Seconds 10
Start-Process "chrome" "http://localhost:3000"

Write-Host "✨ All set! The orchestrator is starting up." -ForegroundColor Green
