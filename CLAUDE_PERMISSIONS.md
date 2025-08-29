# Claude Code Permissions Management

🚨 **READ THIS ENTIRE FILE** 🚨
**CRITICAL: You MUST read this complete file from start to finish. Do not truncate or skip sections.**

This document tracks Claude Code permissions and provides instructions for updating them across development environments.

## Current Allowed Commands

Last updated: 2025-08-29 (Initial setup for Claude Orchestrator project)

### Git Operations
- `Bash(git:*)` - All git commands
- `Bash(gh:*)` - GitHub CLI commands

### Package Managers & Node.js
- `Bash(npm:*)` - NPM commands
- `Bash(yarn:*)` - Yarn commands
- `Bash(pnpm:*)` - PNPM commands
- `Bash(node:*)` - Node.js commands
- `Bash(npx:*)` - NPX commands

### File Operations
- `Bash(ls:*)` - List directory contents
- `Bash(pwd:*)` - Print working directory
- `Bash(cd:*)` - Change directory
- `Bash(mkdir:*)` - Create directories
- `Bash(rm:*)` - Remove files/directories
- `Bash(rmdir:*)` - Remove directories
- `Bash(mv:*)` - Move/rename files
- `Bash(cp:*)` - Copy files
- `Bash(cat:*)` - Display file contents
- `Bash(echo:*)` - Print text
- `Bash(touch:*)` - Create files/update timestamps

### Search & Process Management
- `Bash(grep:*)` - Text search
- `Bash(rg:*)` - Ripgrep search
- `Bash(find:*)` - Find files
- `Bash(which:*)` - Locate commands
- `Bash(test:*)` - Test conditions
- `Bash(curl:*)` - HTTP requests
- `Bash(wget:*)` - Download files
- `Bash(ps:*)` - Process status
- `Bash(kill:*)` - Terminate processes
- `Bash(pkill:*)` - Kill processes by name

### Text Processing & System Tools
- `Bash(awk:*)` - Text processing and analysis
- `Bash(sed:*)` - Stream editor for file modifications
- `Bash(chmod:*)` - Change file permissions
- `Bash(chown:*)` - Change file ownership
- `Bash(sort:*)` - Sort text
- `Bash(uniq:*)` - Remove duplicate lines
- `Bash(head:*)` - Show first lines of files
- `Bash(tail:*)` - Show last lines of files
- `Bash(wc:*)` - Word/line/character count

### Development & Runtime
- `Bash(python3:*)` - Python scripting
- `Bash(python:*)` - Python scripting
- `Bash(pip:*)` - Python package manager
- `Bash(cargo:*)` - Rust package manager
- `Bash(rustc:*)` - Rust compiler
- `Bash(tauri:*)` - Tauri commands

### Archival & Compression
- `Bash(tar:*)` - Archive operations
- `Bash(zip:*)` - Create zip files
- `Bash(unzip:*)` - Extract zip files
- `Bash(gzip:*)` - Compress files
- `Bash(gunzip:*)` - Decompress files

### System Information
- `Bash(uname:*)` - System information
- `Bash(whoami:*)` - Current user
- `Bash(date:*)` - Date and time
- `Bash(env:*)` - Environment variables
- `Bash(export:*)` - Set environment variables

### Claude Code Built-in Tools
- `Task` - Launch sub-agents
- `Glob` - File pattern matching
- `Grep` - Content search
- `LS` - List files
- `Read` - Read files
- `Edit` - Edit files
- `MultiEdit` - Multiple edits
- `Write` - Write files
- `WebFetch` - Fetch web content
- `WebSearch` - Search the web
- `TodoWrite` - Task management
- `ExitPlanMode` - Exit planning mode

## Commands Needing Permission

When Claude needs permission for a new command, it will be added here:

### Pending Review
<!-- Claude will add new commands here when permission is needed -->

### Recently Added
<!-- Move approved commands here before adding to main list -->

## Project-Specific Command Patterns

### Node.js Development
```bash
# Common development commands
npm run dev
npm run build  
npm run test
npm run lint

# Package management
npm install
npm update
npm audit
```

### Tauri Development
```bash
# Tauri-specific commands
npm run tauri:dev
npm run tauri:build
cargo build
cargo check
```

### Git Workflow
```bash
# Standard git operations
git status
git add .
git commit -m "message"
git push
git pull
git fetch
git checkout -b feature/name
```

### System Operations
```bash
# File operations
ls -la
find . -name "*.js"
grep -r "pattern" src/
chmod +x script.sh
```

## Security Notes

- Never add `Bash` without restrictions - it allows ALL system commands
- Be specific with patterns when possible
- Avoid commands that could modify system files outside the project
- Always validate file paths are within project directory

## Adding New Commands

To add new commands to the allowed list:

1. **Identify the command pattern** you need
2. **Add to the appropriate section** above
3. **Test the command** works as expected
4. **Document any security considerations**

### Command Pattern Examples

- `Bash(docker:*)` - All Docker commands
- `Bash(docker ps:*)` - Only `docker ps` command
- `Bash(systemctl start:*)` - Only start services

## Environment-Specific Considerations

### Development Environment
- Full access to development tools
- Local file system operations
- Package management commands

### CI/CD Environment
- Restricted to build and test commands
- No system modification commands
- Limited network access

### Production Environment
- Minimal command access
- Only essential operational commands
- No development tools access

---
🚨 **END OF FILE - ENSURE YOU READ EVERYTHING ABOVE** 🚨