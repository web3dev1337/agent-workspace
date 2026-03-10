@echo off
REM ============================================
REM Agent Workspace - Windows Startup Script
REM ============================================
REM This script waits for WSL to be ready, then launches
REM VS Code with the orchestrator and opens the browser.
REM
REM Install via: scripts/windows/install-startup.ps1
REM Or manually add to Task Scheduler
REM ============================================

echo Starting Agent Workspace...
echo.

REM Configuration - modify these if needed
set "WSL_DISTRO=Ubuntu"
set "ORCHESTRATOR_PORT=3000"
set "BROWSER_URL=http://localhost:%ORCHESTRATOR_PORT%"

REM Auto-detect orchestrator path from this script's location
set "SCRIPT_DIR=%~dp0"
REM Go up from scripts/windows to repo root
for %%i in ("%SCRIPT_DIR%..\..\") do set "REPO_ROOT=%%~fi"

REM Wait for WSL to be ready (up to 60 seconds)
echo Waiting for WSL to initialize...
set /a attempts=0
set /a max_attempts=12

:wait_for_wsl
set /a attempts+=1
wsl -d %WSL_DISTRO% -e echo "ready" >nul 2>&1
if %errorlevel% equ 0 (
    echo WSL is ready!
    goto wsl_ready
)
if %attempts% geq %max_attempts% (
    echo WARNING: WSL may not be fully ready, continuing anyway...
    goto wsl_ready
)
echo   Attempt %attempts%/%max_attempts% - waiting 5 seconds...
timeout /t 5 /nobreak >nul
goto wait_for_wsl

:wsl_ready
echo.

REM Get WSL path for the orchestrator
for /f "tokens=*" %%p in ('wsl -d %WSL_DISTRO% wslpath -u "%REPO_ROOT%"') do set "WSL_PATH=%%p"
echo Orchestrator path: %WSL_PATH%

REM Open VSCode with the orchestrator folder in WSL
echo Opening VS Code...
code --folder-uri "vscode-remote://wsl+%WSL_DISTRO%%WSL_PATH%"

REM Wait for server to start, then open browser
echo Waiting for server to start...
timeout /t 10 /nobreak >nul

REM Check if server is responding before opening browser
:check_server
curl -s -o nul -w "%%{http_code}" %BROWSER_URL% >nul 2>&1
if %errorlevel% equ 0 (
    echo Server is running!
    start "" %BROWSER_URL%
) else (
    echo Server not ready yet, opening browser anyway...
    start "" %BROWSER_URL%
)

echo.
echo Orchestrator started! Check VS Code terminal for details.
