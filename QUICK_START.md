# 🚀 Agent Orchestrator - Quick Start Guide (repo: `claude-orchestrator`)

## Morning-safe dev (recommended)

If you already run another orchestrator instance from the separate `/master` worktree (often on port `3000`), use the dev worktree safe commands so nothing collides.

- Start web UI on safe ports (server `:4001`, client `:4100`): `npm run dev:web:safe`
- Run end-to-end tests on a safe port (auto-picks a free port starting at `:4001`): `npm run test:e2e:safe`

## One-Click Launch Options

You now have **THREE** ways to launch the Agent Orchestrator with full automation:

### Option 1: Windows Desktop Batch File (Simplest)
**Location:** `Desktop/Launch-Orchestrator.bat`

1. Double-click `Launch-Orchestrator.bat` on your desktop
2. VS Code will open to the orchestrator workspace
3. The server will auto-start (`npm start`)
4. Chrome will open to `http://localhost:2080` after 10 seconds

**Pros:** Simple, no permissions needed, works immediately

### Option 2: PowerShell Script (Most Flexible)
**Location:** `Desktop/Launch-Orchestrator.ps1`

1. Right-click `Launch-Orchestrator.ps1` → "Run with PowerShell"
2. Same auto-magic as Option 1

**Pros:** More customizable, better error messages

### Option 3: Windows Shortcut (Cleanest)
**To create the shortcut:**

1. Double-click `Desktop/create-orchestrator-shortcut.vbs`
2. A new shortcut `🚀 Claude Orchestrator` will appear on your desktop
3. Double-click the shortcut to launch

**Pros:** Professional-looking icon, can pin to taskbar/Start menu

## What Happens When You Launch?

1. **VS Code Opens** to the orchestrator workspace in WSL
2. **Terminal Opens** automatically in the correct folder
3. **`npm start` runs** automatically (starts all 4 services)
4. **Chrome Opens** to `http://localhost:2080` after a few seconds
5. **You're ready to work!** Everything is running

## Manual Launch (If Needed)

If you want to launch without auto-start:

```bash
# From WSL terminal
cd ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev
code orchestrator.code-workspace
```

If you also have a separate live worktree at `~/GitHub/tools/automation/claude-orchestrator/master` (often running on port `3000`), do not edit that folder while developing here.

Then manually run `npm start` in the integrated terminal if auto-start didn't work.

## Pinning to Taskbar/Start Menu

**For the Batch File:**
1. Right-click `Launch-Orchestrator.bat` → "Pin to taskbar"

**For the Shortcut:**
1. Create shortcut using Option 3
2. Right-click `🚀 Claude Orchestrator` → "Pin to Start" or "Pin to taskbar"

## Troubleshooting

### Auto-start doesn't work
- Make sure you're opening the `orchestrator.code-workspace` file
- Check that VS Code trusts the workspace (you'll see a prompt on first open)
- Manually run Task: "Auto-Start Orchestrator" from Command Palette (Ctrl+Shift+P)

### Browser doesn't open
- Chrome might not be in your PATH
- The script waits 8-10 seconds - give it time
- Manually navigate to `http://localhost:2080` in any browser

### Permission errors with PowerShell
```powershell
# Run this in PowerShell as Administrator (one time only):
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Files Created

**On Windows Desktop:**
- `Launch-Orchestrator.bat` - Simple batch launcher
- `Launch-Orchestrator.ps1` - PowerShell launcher
- `create-orchestrator-shortcut.vbs` - Shortcut creator
- `🚀 Claude Orchestrator.lnk` - Desktop shortcut (after running VBS)

**In Orchestrator Folder:**
- `orchestrator.code-workspace` - VS Code workspace config
- `.vscode/tasks.json` - Auto-run tasks (updated)

## What's Running?

When `npm start` executes, it launches:
1. **Express Server** (backend) - Port 3000
2. **Client Dev Server** (web UI) - Port 2080
3. **Tauri App** (native desktop app)
4. **Diff Viewer** (PR review tool) - Port 7655

You can access the web UI at `http://localhost:2080` or use the native Tauri app.

If you use `npm run dev:web:safe`, it runs only the web UI and avoids port `3000`.

## Projects + Chats (Simple Mode)

The Codex-style shell is now available as a top-level workflow.

- Open with header button `🧵 Chats` or hotkey `Alt+P`
- Create a new thread with `+ New Chat` (creates worktree + sessions + thread record)
- Use `Close`/`Archive` on chat rows for lifecycle actions
- Configure behavior in `Settings → Projects + Chats`:
  - enable/disable shell
  - open on startup
  - enable/disable hotkey
  - show/hide shell hints

---

**Need help?** Check the main README.md or CLAUDE.md for more details.
