# Windows Launcher Scripts

These scripts provide one-click launching of the Agent Workspace from Windows.

## Quick Setup

1. **Copy launcher to Desktop:**
   ```bash
   # From WSL terminal
   cp scripts/windows-launchers/Launch-Orchestrator.bat /mnt/c/Users/YOUR_USERNAME/Desktop/
   ```

2. **Update the path** (if needed):
   - Open the `.bat` file in Notepad
   - Change the path on line with `code --folder-uri` to match your setup
   - Default is: `~/GitHub/tools/automation/agent-workspace/master`

3. **Double-click to launch!**

## What Gets Launched

When you run the launcher:

1. ✅ VS Code opens to the orchestrator workspace in WSL
2. ✅ Terminal auto-runs `npm start` (via `.vscode/tasks.json`)
3. ✅ Chrome opens to `http://localhost:3000` after 10 seconds
4. ✅ All 4 services start automatically:
   - Express Server (backend) - Port 3000
   - Client Dev Server (web UI) - Port 2080
   - Tauri App (native desktop)
   - Diff Viewer (PR review) - Port 7655

## Available Launchers

### Launch-Orchestrator.bat (Recommended)
- Simple Windows batch file
- Works immediately, no permissions needed
- Can pin to taskbar or Start menu

### Launch-Orchestrator.ps1 (Alternative)
- PowerShell version with better error messages
- May require execution policy change:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

## Customization

Edit the launcher to change:
- **Port**: Change `localhost:3000` to your preferred port
- **Browser**: Change `chrome` to `firefox`, `msedge`, etc.
- **Delay**: Change `timeout /t 10` to adjust wait time
- **WSL Path**: Update the folder URI to match your installation

## Troubleshooting

**VS Code doesn't open to WSL:**
- Make sure WSL extension is installed in VS Code
- Check that the path matches your orchestrator location

**Auto-start doesn't work:**
- Open VS Code manually and check if workspace is trusted
- Run "Tasks: Run Task" → "Auto-Start Orchestrator" manually
- Check `.vscode/tasks.json` exists

**Browser doesn't open:**
- Chrome might not be in your PATH
- Try changing `chrome` to `start chrome` or full path
- Manually navigate to `http://localhost:3000`

## Advanced: Create Desktop Shortcut

For a professional shortcut with custom icon:

1. Right-click Desktop → New → Shortcut
2. Target: `C:\Windows\System32\cmd.exe /c "path\to\Launch-Orchestrator.bat"`
3. Name it: `🚀 Agent Workspace`
4. Right-click → Properties → Change Icon
5. Pin to taskbar or Start menu!
