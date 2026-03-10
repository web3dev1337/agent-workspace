# ============================================
# Agent Workspace - Windows Startup Installer
# ============================================
# This script:
# 1. Creates a scheduled task to run orchestrator on login
# 2. Optionally creates a desktop shortcut
#
# Run with: powershell -ExecutionPolicy Bypass -File install-startup.ps1
# ============================================

param(
    [switch]$Uninstall,
    [switch]$DesktopShortcut,
    [switch]$NoStartupTask,
    [string]$WslDistro = "Ubuntu",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$TaskName = "Launch Orchestrator"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ScriptDir "start-orchestrator.bat"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Agent Workspace - Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Uninstall mode
if ($Uninstall) {
    Write-Host "Removing scheduled task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Done! Startup task removed." -ForegroundColor Green
    exit 0
}

# Check if start script exists
if (-not (Test-Path $StartScript)) {
    Write-Host "ERROR: start-orchestrator.bat not found at:" -ForegroundColor Red
    Write-Host "  $StartScript" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure you're running this from the scripts/windows directory." -ForegroundColor Yellow
    exit 1
}

Write-Host "Start script: $StartScript" -ForegroundColor Gray
Write-Host "WSL Distro: $WslDistro" -ForegroundColor Gray
Write-Host "Port: $Port" -ForegroundColor Gray
Write-Host ""

# Create scheduled task for startup
if (-not $NoStartupTask) {
    Write-Host "Creating startup task..." -ForegroundColor Yellow

    # Remove existing task if present
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    # Create the action
    $Action = New-ScheduledTaskAction -Execute $StartScript -WorkingDirectory $ScriptDir

    # Trigger on user logon
    $Trigger = New-ScheduledTaskTrigger -AtLogon

    # Settings
    $Settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

    # Register the task
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description "Launches Agent Workspace on Windows startup" `
        -RunLevel Limited | Out-Null

    Write-Host "Startup task created!" -ForegroundColor Green
}

# Create desktop shortcut
if ($DesktopShortcut) {
    Write-Host "Creating desktop shortcut..." -ForegroundColor Yellow

    $Desktop = [Environment]::GetFolderPath("Desktop")
    $ShortcutPath = Join-Path $Desktop "Agent Workspace.lnk"

    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $StartScript
    $Shortcut.WorkingDirectory = $ScriptDir
    $Shortcut.Description = "Launch Agent Workspace"
    $Shortcut.Save()

    Write-Host "Desktop shortcut created!" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "The orchestrator will now start automatically when you log in." -ForegroundColor Cyan
Write-Host ""
Write-Host "To test it now, run:" -ForegroundColor Gray
Write-Host "  $StartScript" -ForegroundColor White
Write-Host ""
Write-Host "To remove, run:" -ForegroundColor Gray
Write-Host "  .\install-startup.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
