# Agent Workspace - Startup Scripts

Platform-specific scripts for auto-starting the orchestrator on system boot/login.

## Windows (WSL)

### Quick Install

From PowerShell (as Administrator):

```powershell
cd path\to\agent-workspace\scripts\windows
powershell -ExecutionPolicy Bypass -File install-startup.ps1
```

### Options

```powershell
# Install with desktop shortcut
.\install-startup.ps1 -DesktopShortcut

# Install without startup task (just shortcut)
.\install-startup.ps1 -DesktopShortcut -NoStartupTask

# Specify WSL distro
.\install-startup.ps1 -WslDistro "Ubuntu-22.04"

# Uninstall
.\install-startup.ps1 -Uninstall
```

### What It Does

1. Creates a Windows Task Scheduler task that runs on login
2. The task waits for WSL to be ready (up to 60 seconds)
3. Opens VS Code with the orchestrator folder in WSL remote
4. Waits for server to start, then opens browser

### Files

- `start-orchestrator.bat` - The startup script (waits for WSL, launches VS Code)
- `install-startup.ps1` - Installer (creates scheduled task and/or desktop shortcut)

## Linux (Native)

### Quick Install

```bash
cd path/to/agent-workspace/scripts/linux
chmod +x install-startup.sh start-orchestrator.sh
./install-startup.sh
```

### Files

- `start-orchestrator.sh` - Starts server and opens browser
- `install-startup.sh` - Creates systemd user service or XDG autostart

## macOS

Coming soon. For now, use Login Items in System Preferences.

## Manual Setup

If the installers don't work for your setup:

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task → "Launch Orchestrator"
3. Trigger: "When I log on"
4. Action: Start a program → Browse to `scripts/windows/start-orchestrator.bat`
5. Finish

### Linux systemd

```bash
# Create user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/agent-workspace.service << EOF
[Unit]
Description=Agent Workspace
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/agent-workspace
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# Enable and start
systemctl --user enable agent-workspace
systemctl --user start agent-workspace
```

## Troubleshooting

### WSL not ready error
The script waits up to 60 seconds for WSL. If that's not enough:
- Edit `start-orchestrator.bat` and increase `max_attempts`
- Check WSL health: `wsl --status`

### VS Code doesn't open in WSL
- Ensure VS Code Remote - WSL extension is installed
- Try: `code --folder-uri "vscode-remote://wsl+Ubuntu/path/to/folder"`

### Browser opens before server is ready
- Increase the `timeout` value in the startup script
- Or just refresh the browser after a few seconds

## Repo Utilities

Repo-maintenance helpers live in purpose-specific folders so the project root stays clean:

- `scripts/debug/` - manual one-off debug helpers for config/cascade inspection
- `scripts/local/` - local-machine setup helpers for legacy/non-portable workflows
- `scripts/mobile/` - mobile/LAN launch helpers
- `scripts/windows/allow-firewall.ps1` - add a Windows firewall rule for the app port
- `scripts/windows/allow-node-firewall.ps1` - allow the current Node.js executable through Windows firewall

## Markdown Remaining Scanner

`scripts/scan-markdown-remaining.js` scans markdown files for unchecked tasks, TODO/FIXME markers, and “remaining” sections.

Examples:

```bash
# Full markdown report to stdout
node scripts/scan-markdown-remaining.js --scope all

# JSON output (explicit)
node scripts/scan-markdown-remaining.js --scope recent --since-days 14 --json --output /tmp/md-remaining.json

# JSON output (auto by .json extension)
node scripts/scan-markdown-remaining.js --scope recent --since-days 14 --output /tmp/md-remaining.json

# Actionable-only view (filters template/generated-scan noise)
node scripts/scan-markdown-remaining.js --scope all --actionable-only

# Backlog-only view (keeps backlog docs with remaining markers, including heuristic sections)
node scripts/scan-markdown-remaining.js --scope recent --since-days 30 --backlog-only
```
