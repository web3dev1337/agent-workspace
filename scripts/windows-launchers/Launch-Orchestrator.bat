@echo off
REM Agent Workspace - One-Click Launcher for Windows
REM Copy this file to your Windows Desktop for easy access
REM
REM This script will:
REM   1. Open VS Code to the orchestrator folder in WSL
REM   2. Auto-run 'npm start' via VS Code tasks
REM   3. Open Chrome to http://localhost:3000

echo.
echo ========================================
echo   Agent Workspace - Quick Launch
echo ========================================
echo.
echo Starting VS Code with orchestrator...
echo.

REM NOTE: Update the path below if your orchestrator is in a different location
REM Default: /home/YOUR_USERNAME/GitHub/tools/automation/agent-workspace/master
code --folder-uri "vscode-remote://wsl+Ubuntu/home/YOUR_USERNAME/GitHub/tools/automation/agent-workspace/master"

echo.
echo VS Code launched!
echo The orchestrator will auto-start in a few seconds...
echo Browser will open automatically to http://localhost:3000
echo.

REM Wait for server to start, then open browser
timeout /t 10 /nobreak > nul
start chrome http://localhost:3000

exit
