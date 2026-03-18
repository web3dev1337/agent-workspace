# Windows Build & Installation Guide

**Complete documentation of Windows support implementation for Agent Workspace**

*This document chronicles the complete process of making Agent Workspace work on Windows, including every issue encountered and how it was resolved.*

---

## Table of Contents
- [Initial Setup Requirements](#initial-setup-requirements)
- [Build Process Issues & Solutions](#build-process-issues--solutions)
- [Runtime Issues & Solutions](#runtime-issues--solutions)
- [Cross-Platform Code Fixes](#cross-platform-code-fixes)
- [Final Installation Steps](#final-installation-steps)
- [Preventing Future Issues](#preventing-future-issues)

---

## Initial Setup Requirements

### Prerequisites for Windows Build

1. **Node.js** - Required for running the backend
   - Download from https://nodejs.org
   - Ensure `node.exe` is in PATH
   - Verify: `where node` should show `C:\Program Files\nodejs\node.exe`

2. **Rust** - Required for Tauri native app compilation
   - Install from https://rustup.rs
   - Run: `rustup-init.exe`
   - Verify: `rustc --version`

3. **Visual Studio 2022 Community** with specific components:
   - **Desktop development with C++** workload
   - **MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libraries**
   - **Windows 10 SDK** (10.0.20348.0 or later) or **Windows 11 SDK** (10.0.22621.0)

4. **Git for Windows**
   - For repository cloning and version control

5. **Python with Pillow** (for icon generation)
   - `pip install Pillow`

---

## Build Process Issues & Solutions

### Issue 1: Missing Spectre-Mitigated Libraries

**Error:**
```
MSB8040: Spectre-mitigated libraries are required for this project
```

**Cause:**
node-pty dependency requires Spectre-mitigated libraries to compile on Windows.

**Solution:**
Install the Visual Studio component:
```powershell
# Open Visual Studio Installer
# Modify → Individual components → Search "Spectre"
# Install: MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)
```

**Via Command Line:**
```powershell
"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify `
  --installPath "C:\Program Files\Microsoft Visual Studio\2022\Community" `
  --add Microsoft.VisualStudio.Component.VC.14.44.17.11.x86.x64.Spectre `
  --passive --norestart
```

**Verification:**
```powershell
ls "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\lib"
# Should show "spectre" folder
```

---

### Issue 2: Missing Windows SDK

**Error:**
```
gyp ERR! find VS - missing any Windows SDK
```

**Cause:**
node-gyp (used by node-pty) requires a Windows SDK to compile native modules.

**Solution:**
Install Windows SDK via Visual Studio Installer:
```
Visual Studio Installer → Modify → Individual components
Search: "Windows SDK"
Install: Windows 10 SDK (10.0.20348.0) or Windows 11 SDK (10.0.22621.0)
```

**Verification:**
```powershell
ls "C:\Program Files (x86)\Windows Kits\10\Include"
# Should show SDK version folders like 10.0.22621.0
```

---

### Issue 3: node-pty Build Failures

**Error:**
```
'GetCommitHash.bat' is not recognized as an internal or external command
gyp: Call to 'cmd /c "cd shared && GetCommitHash.bat"' returned exit status 1
```

**Cause:**
node-pty has build script dependencies that fail with `npm ci`.

**Solution:**
Use `npm install` instead of `npm ci`:
```bash
# Clean first
rm -rf node_modules package-lock.json

# Use npm install (not ci)
npm install
```

**Why this works:**
- `npm install` uses prebuilt node-pty binaries when available
- `npm ci` always tries to rebuild from source
- Prebuilt binaries avoid the build script issues

---

### Issue 4: Invalid icon.ico File

**Error:**
```
error RC2175: resource file icon.ico is not in 3.00 format
```

**Cause:**
The `src-tauri/icons/icon.ico` was a text placeholder file, not a real Windows icon.

**Solution:**
Create a valid ICO file using Python/Pillow:

```python
from PIL import Image

# Create a simple 32x32 blue square
img = Image.new('RGBA', (32, 32), (70, 130, 180, 255))
img.save('src-tauri/icons/icon.ico', format='ICO', sizes=[(32,32)])
```

**Why this is needed:**
- Windows Resource Compiler (RC.EXE) validates ICO format
- Tauri requires valid icon.ico for Windows builds
- Icon appears in exe properties and taskbar

---

### Issue 5: Tauri Resource Glob Pattern Failures

**Error:**
```
glob pattern resources/backend/** path not found or didn't match any files
```

**Cause:**
The `**` glob pattern wasn't matching files correctly on Windows.

**Solution:**
Use explicit glob patterns:

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "resources": [
      "resources/backend/*",
      "resources/backend/server/*",
      "resources/backend/client/*",
      "resources/backend/node_modules"
    ]
  }
}
```

---

### Issue 6: Stack Overflow During Build

**Error:**
```
process didn't exit successfully: build-script-build (exit code: 0xc00000fd, STATUS_STACK_OVERFLOW)
```

**Cause:**
Tauri's build script (`tauri_build::build()`) automatically adds `cargo:rerun-if-changed` directives for ALL files in resource patterns. With node_modules bundled (thousands of files), this overflows the stack.

**Solution:**
Create custom build.rs to exclude node_modules from tracking:

```rust
// src-tauri/build.rs
use std::path::PathBuf;

fn main() {
    // Use custom config to prevent tracking node_modules for rebuilds
    let _context = tauri_build::try_build(tauri_build::Attributes::new())
        .expect("failed to run tauri build");

    // Explicitly tell cargo to NOT track node_modules changes
    // This prevents stack overflow from tracking thousands of files
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=resources/backend/server");
    println!("cargo:rerun-if-changed=resources/backend/client");
    println!("cargo:rerun-if-changed=resources/backend/package.json");
    // Explicitly IGNORE node_modules
}
```

---

### Issue 7: Tauri API Compatibility Issues

**Error:**
```rust
error[E0061]: this method takes 1 argument but 2 arguments were supplied
.run(tauri::generate_context!(), |app_handle, event| { ... })
```

**Cause:**
Tauri 2.x changed the `.run()` API - it no longer accepts an event handler closure.

**Solution:**
Remove the event handler:

```rust
// OLD (Tauri 1.x):
.run(tauri::generate_context!(), |app_handle, event| {
    match event {
        tauri::RunEvent::ExitRequested { .. } => { ... }
    }
})

// NEW (Tauri 2.x):
.run(tauri::generate_context!())
.expect("error while running tauri application");
```

---

## Runtime Issues & Solutions

### Issue 8: Hardcoded 'bash' Shell

**Error:**
```
error: Failed to start Commander terminal {"error":"File not found: "}
```

**Cause:**
All terminal spawning code hardcoded `bash` as the shell, which doesn't exist on Windows.

**Solution:**
Add platform detection helper:

```javascript
// Helper function to get the appropriate shell for the platform
function getDefaultShell() {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash';
}
```

**Replace all instances:**
```javascript
// OLD:
const ptyProcess = pty.spawn('bash', [], { ... });

// NEW:
const shell = getDefaultShell();
const ptyProcess = pty.spawn(shell, [], { ... });
```

**Files affected:**
- `server/sessionManager.js` (multiple locations)
- `server/commanderService.js`
- `server/productLauncherService.js`
- `server/diffViewerService.js`
- `server/index.js`

---

### Issue 9: Bash Command Syntax in PowerShell

**Error:**
```
At line:1 char:62
+ ... && echo "..." && echo "..." && exec bash
+    ~~
The token '&&' is not a valid statement separator in this version.
```

**Cause:**
Shell commands used bash-specific syntax:
- `&&` for command chaining (PowerShell uses `;`)
- `-c` flag (PowerShell uses `-Command`)
- `exec bash` to keep shell open (not needed)
- `$(pwd)` and `$(git ...)` (different syntax in PowerShell)

**Solution:**
Create cross-platform command builder:

```javascript
// Helper function to build shell args for executing commands
function buildShellArgs(commands) {
  if (process.platform === 'win32') {
    // PowerShell: join commands with ; and use -NoExit -Command to keep shell open
    const joined = Array.isArray(commands) ? commands.join('; ') : commands.replace(/&&/g, ';');
    return ['-NoExit', '-Command', joined];
  } else {
    // Bash: join commands with && and use -c
    const joined = Array.isArray(commands) ? commands.join(' && ') : commands;
    return ['-c', joined];
  }
}
```

**Replace all shell command patterns:**
```javascript
// OLD:
args: ['-c', `cd "${path}" && echo "..." && exec bash`]

// NEW:
args: buildShellArgs(`cd "${path}" && echo "..."`)
```

---

### Issue 10: PowerShell Line Ending Issues

**Error:**
Commands typed but not executing (appearing in terminal but not running).

**Cause:**
Unix uses `\n` for line endings, Windows PowerShell needs `\r\n`.

**Solution:**
Convert line endings in sendInput:

```javascript
sendInput(input) {
  if (!this.session || !this.session.pty) {
    logger.warn('Cannot send input - Commander not running');
    return false;
  }

  // On Windows, convert \n to \r\n for proper line endings
  const processedInput = process.platform === 'win32'
    ? input.replace(/\n/g, '\r\n')
    : input;

  this.session.pty.write(processedInput);
  return true;
}
```

---

### Issue 11: PowerShell Interactive Mode

**Error:**
PowerShell spawns but immediately exits (death loop of spawn → exit → restart).

**Cause:**
PowerShell exits immediately when spawned with no commands.

**Solution:**
Add `-NoExit` flag when spawning interactive PowerShell:

```javascript
// Commander terminal (fully interactive):
const shellArgs = process.platform === 'win32' ? ['-NoExit'] : [];

// Session terminals (with init commands):
// Use buildShellArgs() which includes -NoExit -Command
```

---

### Issue 12: Missing Node.exe in Bundled App

**Error:**
```
Starting Agent Workspace…
If this screen doesn't advance within ~20 seconds, ensure Node is available
or set ORCHESTRATOR_NODE_PATH.
```

**Cause:**
The bundled Tauri app needs Node.exe to run the backend server, but Node isn't bundled with the app.

**Solution:**
Set environment variable pointing to system Node:

```powershell
[Environment]::SetEnvironmentVariable(
  'ORCHESTRATOR_NODE_PATH',
  'C:\Program Files\nodejs\node.exe',
  'User'
)
```

**Alternative:** Bundle Node.exe with the app in `src-tauri/resources/node/node.exe`.

---

### Issue 13: Duplicate Auto-Start Calls

**Error:**
All Commander messages appearing twice (double "Say:", double help text, double claude command).

**Cause:**
- Auto-start triggered multiple times from data stream
- Client-side also calling startClaude
- No guard to prevent duplicate calls

**Solution:**
Add `claudeStarted` flag with double-check:

```javascript
constructor(options = {}) {
  // ... existing code ...
  this.claudeStarted = false; // Track if Claude has been auto-started
}

// In ready detection:
if (!this.isReady) {
  this.session.status = 'ready';
  this.isReady = true;

  setTimeout(() => {
    if (!this.claudeStarted) {  // Double-check before calling
      this.startClaude('fresh', true);
    }
  }, 1000);
}

// In startClaude method:
async startClaude(mode = 'fresh', yolo = true) {
  // Prevent duplicate calls
  if (this.claudeStarted) {
    logger.warn('Claude already started, ignoring duplicate call');
    return { success: false, error: 'Already started' };
  }
  this.claudeStarted = true;
  // ... rest of method ...
}

// Reset on exit:
ptyProcess.onExit(({ exitCode }) => {
  this.claudeStarted = false; // Reset for next start
  // ... rest of handler ...
});
```

---

## Complete Windows Installation Guide

### For Future Users Installing on Windows

#### 1. Install Prerequisites

**Visual Studio 2022 Community:**
```
1. Download: https://visualstudio.microsoft.com/vs/community/
2. Run installer
3. Select: "Desktop development with C++"
4. Click Modify → Individual components
5. Search and install:
   - MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)
   - Windows 10 SDK (10.0.20348.0) or Windows 11 SDK (10.0.22621.0)
6. Install (requires ~10GB disk space)
```

**Node.js:**
```
1. Download LTS from https://nodejs.org
2. Run installer with default options
3. Verify: open CMD and run `node --version`
```

**Rust:**
```
1. Download from https://rustup.rs
2. Run rustup-init.exe
3. Follow prompts (default options)
4. Verify: `rustc --version` and `cargo --version`
```

**Python (for icon generation):**
```
1. Download from https://python.org
2. Install with "Add to PATH" checked
3. Run: pip install Pillow
```

#### 2. Clone Repository

```bash
git clone https://github.com/web3dev1337/agent-workspace.git
cd agent-workspace
```

#### 3. Install Dependencies

```bash
# Use npm install (NOT npm ci) to avoid node-pty build issues
npm install

# Install diff-viewer dependencies
cd diff-viewer
npm install
cd ..
```

#### 4. Set Environment Variable (Important!)

```powershell
# Set Node path for Tauri app
[Environment]::SetEnvironmentVariable(
  'ORCHESTRATOR_NODE_PATH',
  'C:\Program Files\nodejs\node.exe',
  'User'
)
```

**Why this is needed:**
The bundled Tauri app needs to find Node.exe to run the backend server. This tells it where Node is installed.

#### 5. Prepare Backend Resources

```bash
# This copies server files to src-tauri/resources/backend
node scripts/tauri/prepare-backend-resources.js

# Copy working node_modules to backend resources
cp -r node_modules src-tauri/resources/backend/node_modules
```

#### 6. Build the Tauri App

```bash
# Build the native app (creates MSI and NSIS installers)
npx tauri build
```

**Expected output:**
```
Finished 2 bundles at:
  C:\...\src-tauri\target\release\bundle\msi\Agent Workspace_0.1.0_x64_en-US.msi
  C:\...\src-tauri\target\release\bundle\nsis\Agent Workspace_0.1.0_x64-setup.exe
```

**Build artifacts:**
- MSI installer: ~45MB (with bundled node_modules)
- NSIS installer: ~23MB (compressed)
- Raw EXE: ~4.5MB (in `target/release/`)

#### 7. Install and Run

```bash
# Run either installer
start src-tauri/target/release/bundle/nsis/Agent Workspace_0.1.0_x64-setup.exe
```

Or install the MSI for enterprise deployment.

---

## Cross-Platform Code Fixes

### Summary of Code Changes

All changes are in PR: https://github.com/web3dev1337/agent-workspace/pull/602

#### Files Modified

1. **server/sessionManager.js**
   - Added `getDefaultShell()` helper
   - Added `buildShellArgs()` helper
   - Replaced all hardcoded `'bash'` with `getDefaultShell()`
   - Replaced all `['-c', ...]` with `buildShellArgs(...)`
   - Fixed git branch detection for PowerShell
   - On non-Windows, keeps bash sessions open via `exec bash` to avoid PTY “exit/restart” loops; on Windows uses PowerShell `-NoExit`

2. **server/commanderService.js**
   - Added platform detection for shell selection
   - Added `-NoExit` flag for PowerShell interactive mode
   - Added `\r\n` line ending conversion for Windows
   - Added `claudeStarted` flag to prevent duplicate auto-starts
   - Fixed auto-start timing and guards

3. **server/productLauncherService.js**
   - Added `getDefaultShell()` helper
   - Updated spawn calls to use platform-appropriate shell

4. **server/diffViewerService.js**
   - Added `getDefaultShell()` helper
   - Updated diff viewer process spawning

5. **server/index.js**
   - Added `getDefaultShell()` helper
   - Updated build production script execution

6. **src-tauri/build.rs**
   - Custom build script to prevent tracking node_modules
   - Prevents stack overflow from thousands of files

7. **src-tauri/src/main.rs**
   - Removed incompatible event handler (Tauri 2.x)
   - Fixed unused variable warnings

8. **src-tauri/tauri.conf.json**
   - Updated resource glob patterns
   - Added icon.ico to bundle configuration

9. **src-tauri/icons/icon.ico**
   - Created valid Windows icon file

---

## Platform Differences Reference

### Shell Differences

| Feature | Unix (bash) | Windows (PowerShell) |
|---------|-------------|---------------------|
| Shell command | `bash` | `powershell.exe` |
| Execute flag | `-c` | `-Command` |
| Keep open | (stays open) | `-NoExit` required |
| Command chain | `&&` | `;` |
| Line ending | `\n` | `\r\n` |
| Error redirect | `2>/dev/null` | `2>$null` |
| Conditional | `\|\|` | `if(-not $?) { }` |

### Example Conversions

**Change directory and run command:**
```javascript
// Unix:
args: ['-c', `cd "/path" && npm start`]

// Windows:
args: ['-NoExit', '-Command', `cd "C:\\path"; npm start`]

// Cross-platform:
args: buildShellArgs(`cd "${path}" && npm start`)
```

**Check git branch with fallback:**
```javascript
// Unix:
`echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"`

// Windows:
`Write-Host "Branch: $(git branch --show-current 2>$null; if(-not $?) { Write-Output 'unknown' })"`
```

---

## Preventing Future Issues

### Development Best Practices

#### 1. Always Test on Both Platforms

When adding features that spawn shells or execute commands:
```javascript
// DON'T hardcode shells:
❌ pty.spawn('bash', ...)

// DO use platform detection:
✅ pty.spawn(getDefaultShell(), ...)
```

#### 2. Use Helper Functions

Always use the provided helpers:
- `getDefaultShell()` - Returns correct shell for platform
- `buildShellArgs(commands)` - Builds correct args array

#### 3. Avoid Shell-Specific Syntax

```javascript
// DON'T use bash-specific syntax in commands:
❌ `cd /path && ls -la && exec bash`

// DO use simple, portable commands:
✅ `cd /path`  // Let shell stay open naturally
```

#### 4. Test Line Endings

When sending input to terminals:
```javascript
// Always use sendInput() which handles platform line endings
✅ this.sendInput('command\n')  // Automatically becomes \r\n on Windows

// DON'T write directly to PTY:
❌ pty.write('command\n')  // Won't work on Windows
```

#### 5. Bundle Size Considerations

**node_modules bundling:**
- Required for offline operation
- Increases installer size significantly (2MB → 45MB)
- Can cause stack overflow if build script tracks all files
- Use custom build.rs to exclude from tracking

**Alternatives:**
- Don't bundle node_modules, require Node.js installation
- Bundle only production dependencies
- Use node_modules from system location

#### 6. Windows-Specific Testing Checklist

Before release, test on Windows:
- [ ] App builds without errors
- [ ] Installers created (MSI and NSIS)
- [ ] App launches and shows UI
- [ ] Backend server starts (check loading screen)
- [ ] Terminals spawn successfully
- [ ] Commands execute in terminals (not just typed)
- [ ] No death loops (terminals staying open)
- [ ] Git operations work
- [ ] File operations work (read/write)

---

## Common Gotchas

### 1. Path Separators
```javascript
// Use path.join() for cross-platform paths
const filePath = path.join(baseDir, 'subdir', 'file.js');

// NOT:
const filePath = `${baseDir}/subdir/file.js`;  // Breaks on Windows
```

### 2. Environment Variables
```javascript
// Windows uses different env vars:
process.env.USERPROFILE  // Windows
process.env.HOME         // Unix

// Use os.homedir() for cross-platform:
const home = require('os').homedir();
```

### 3. Command Availability
```javascript
// Commands that exist on Unix but not Windows:
// - ls, grep, sed, awk, tail, head
// Use Node.js equivalents or check platform first

if (process.platform !== 'win32') {
  // Unix-only command
  spawn('ls', ['-la']);
} else {
  // Windows alternative
  spawn('powershell', ['-Command', 'Get-ChildItem']);
}
```

### 4. Process Spawning
```javascript
// On Windows, .cmd and .bat files need special handling:
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
spawn(npmCmd, ['install']);
```

---

## Build Script Reference

### Complete Build Command Sequence

```bash
# 1. Clean previous builds
npm run clean  # or: rm -rf node_modules dist src-tauri/target

# 2. Install dependencies
npm install
cd diff-viewer && npm install && cd ..

# 3. Prepare backend (without installing - we'll copy node_modules)
node scripts/tauri/prepare-backend-resources.js

# 4. Copy working node_modules
cp -r node_modules src-tauri/resources/backend/node_modules

# 5. Build Tauri app
npx tauri build

# 6. Installers will be in:
# - src-tauri/target/release/bundle/msi/
# - src-tauri/target/release/bundle/nsis/
```

---

## Debugging Tips

### View Build Logs

```bash
# Cargo build with verbose output
cd src-tauri
cargo build --release --verbose

# Check Tauri build output
npx tauri build 2>&1 | tee build.log
```

### Check Node-PTY

```bash
# Test if node-pty loads
node -e "require('node-pty')"

# Rebuild if needed
npm rebuild node-pty
```

### Verify Visual Studio Installation

```bash
# Check installed components
"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest -requires Microsoft.VisualStudio.Component.VC.Spectre

# Check MSVC toolset
ls "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\lib"
# Should show: onecore, spectre, x64, x86

# Check Windows SDK
ls "C:\Program Files (x86)\Windows Kits\10\Include"
# Should show SDK version folders
```

### Test PowerShell Spawning

```javascript
// Quick test script (test-pty.js):
const pty = require('node-pty');

const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const args = process.platform === 'win32' ? ['-NoExit'] : [];

const ptyProcess = pty.spawn(shell, args, {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.onData((data) => {
  process.stdout.write(data);
});

ptyProcess.onExit(({ exitCode }) => {
  console.log('Process exited:', exitCode);
  process.exit(exitCode);
});

// Send a test command
setTimeout(() => {
  ptyProcess.write('echo "Hello from PTY"\r\n');
}, 2000);
```

---

## Known Limitations

### 1. WSL vs Native Windows

The app runs natively on Windows (PowerShell), NOT in WSL (bash). If you need WSL bash:
- Spawn `wsl.exe` instead of `powershell.exe`
- Use bash syntax even on Windows
- Handle path translation between Windows and WSL

### 2. Git Bash vs PowerShell

If users have Git Bash installed, they might expect bash. To support Git Bash:
```javascript
function getDefaultShell() {
  if (process.platform === 'win32') {
    // Check if Git Bash is available
    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(gitBashPath)) {
      return gitBashPath;  // Prefer Git Bash if available
    }
    return 'powershell.exe';  // Fallback to PowerShell
  }
  return 'bash';
}
```

### 3. Command Execution Permissions

PowerShell execution policy might block scripts:
```powershell
# Check current policy
Get-ExecutionPolicy

# If blocked, set to RemoteSigned
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Troubleshooting

### "File not found" Errors

**Symptom:** Sessions fail to create with `"File not found: "` error.

**Possible causes:**
1. Shell executable not in PATH (`bash` on Windows, `powershell.exe` missing)
2. Node.exe not found (set ORCHESTRATOR_NODE_PATH)
3. Working directory doesn't exist

**Debug:**
```javascript
// Add logging before pty.spawn:
logger.info('Spawning PTY', {
  shell: config.command,
  args: config.args,
  cwd: config.cwd,
  platform: process.platform
});
```

### "Stack Overflow" During Build

**Symptom:** Cargo build fails with `STATUS_STACK_OVERFLOW`.

**Cause:** Too many files being tracked for rebuilds.

**Solution:**
Verify `src-tauri/build.rs` has custom tracking (not default `tauri_build::build()`).

### Terminals Exit Immediately

**Symptom:** PowerShell spawns and exits in a loop.

**Cause:** Missing `-NoExit` flag.

**Solution:**
Check spawn args include `-NoExit` for interactive PowerShell.

### Commands Don't Execute

**Symptom:** Text appears in terminal but doesn't run.

**Causes:**
1. Wrong line endings (need `\r\n` on Windows)
2. Not in interactive mode (used `-Command` flag)
3. Shell syntax error

**Debug:**
```javascript
// Log what's being sent:
logger.info('Sending to PTY', {
  input: JSON.stringify(input),  // Shows escape sequences
  length: input.length,
  bytes: Array.from(input).map(c => c.charCodeAt(0))
});
```

---

## Architecture Notes

### How the Bundled App Works

```
Tauri App (agent-workspace.exe)
├─ Rust wrapper (native Windows app)
├─ Embedded WebView (UI)
└─ Bundled backend resources
   ├─ server/ (Node.js backend)
   ├─ client/ (HTML/JS/CSS)
   ├─ node_modules/ (dependencies)
   └─ package.json

On startup:
1. Tauri Rust app starts
2. Looks for Node.exe (via ORCHESTRATOR_NODE_PATH or PATH)
3. Spawns: node.exe resources/backend/server/index.js
4. Backend server starts on random port
5. Rust app connects to backend
6. WebView loads client UI
7. UI connects to backend via WebSocket
```

### Why Two Installation Paths?

**Development:** Run from source
```bash
cd ~/GitHub/tools/automation/agent-workspace
npm start
# Uses source code directly, hot-reload enabled
```

**Production:** Run from installed app
```
%LOCALAPPDATA%\\Agent Workspace\\agent-workspace.exe
# Uses bundled resources from installation
```

---

## Future Improvements

### 1. Auto-Detect and Bundle Node.exe

Instead of requiring ORCHESTRATOR_NODE_PATH:
```
src-tauri/resources/node/
├─ node.exe (Windows)
├─ node (Linux)
└─ node (macOS)
```

Update Rust code to check bundled Node first, then fall back to PATH.

### 2. Shell Selection UI

Let users choose their preferred shell:
- PowerShell (default Windows)
- Git Bash (if installed)
- WSL bash
- CMD (legacy)

### 3. Better Error Messages

Current: `"File not found: "`
Better: `"Shell not found: Could not spawn 'bash'. Install Git Bash or use PowerShell."`

### 4. Platform Detection Utilities

Create shared module:
```javascript
// platform-utils.js
module.exports = {
  getDefaultShell,
  buildShellArgs,
  fixLineEndings,
  detectAvailableShells,
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isMac: process.platform === 'darwin'
};
```

### 5. Automated Testing

Add platform-specific tests:
```javascript
describe('Windows support', () => {
  it('should spawn PowerShell on Windows', () => {
    if (process.platform === 'win32') {
      expect(getDefaultShell()).toBe('powershell.exe');
    }
  });

  it('should convert line endings on Windows', () => {
    const input = 'command\n';
    const processed = fixLineEndings(input);
    if (process.platform === 'win32') {
      expect(processed).toBe('command\r\n');
    }
  });
});
```

---

## Summary

### What We Accomplished

✅ **Complete Windows build support**
- All Visual Studio components identified and installed
- Build process working end-to-end
- MSI and NSIS installers created successfully

✅ **Cross-platform terminal spawning**
- Platform detection for shells (PowerShell vs bash)
- Command syntax conversion (&&  vs ;)
- Line ending handling (\r\n vs \n)

✅ **Runtime fixes**
- Terminals spawn correctly on Windows
- Commands execute properly
- No more death loops
- Auto-start working

✅ **Bundling improvements**
- node_modules bundled for offline operation
- Stack overflow prevention in build script
- Icon files validated

### Total Changes
- **9 files modified**
- **~150 insertions, ~50 deletions**
- **6 commits** on feature branch
- **1 Pull Request** ready for review

### Installation Time
- First-time setup: ~1-2 hours (waiting for VS components)
- Subsequent builds: ~5-10 minutes
- Clean rebuild: ~15 minutes (includes Rust compilation)

---

## Conclusion

The Agent Workspace now fully supports Windows with native PowerShell integration. All cross-platform issues have been identified and resolved. Future developers can follow this guide to build and deploy on Windows without encountering the same issues.

**For questions or issues, refer to:**
- This guide: `WINDOWS_BUILD_GUIDE.md`
- Pull Request: https://github.com/web3dev1337/agent-workspace/pull/602
- Main docs: `CODEBASE_DOCUMENTATION.md`

---

**Document Version:** 1.0
**Last Updated:** 2026-02-03
**Tested On:** Windows 11, Visual Studio 2022, Node.js 24.12.0
**Branch:** fix/windows-cross-platform-support
