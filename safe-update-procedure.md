# Safe Update Procedure for Claude Orchestrator

## Problem
When using Claude to update the Orchestrator, it can kill/restart the very system running your Claude sessions, causing work loss.

## Solution: Dual Instance Setup

### 1. Production Instance (Protected)
- **Location**: `~/claude-orchestrator` or `~/claude-orchestrator-temp`
- **Ports**: 3000 (server), 2080 (client), 1420 (tauri)
- **Rule**: NEVER let Claude modify this directly while in use

### 2. Development Instance (Safe to Modify)
- **Location**: `~/claude-orchestrator-dev`
- **Ports**: 4000 (server), 2081 (client), 1421 (tauri)
- **Rule**: Claude can freely modify this instance

## Workflow

### Phase 1: Development
1. Keep production Orchestrator running your Claude sessions
2. Use Claude to modify the dev instance:
   ```bash
   cd ~/claude-orchestrator-dev
   # Make changes, test, etc.
   ```

3. Test changes on dev instance:
   ```bash
   ./run-dev.sh
   # Browse to http://localhost:4000
   ```

### Phase 2: Deployment
1. Save/commit any work in your Claude sessions
2. Schedule a maintenance window
3. Update production:
   ```bash
   cd ~/claude-orchestrator
   git pull origin main
   npm install
   npm rebuild node-pty  # If needed
   ```

4. Restart production Orchestrator

## Alternative: Hot Reload Strategy

If you need zero-downtime updates:

1. **Use PM2** for process management:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name orchestrator-prod
   ```

2. **Graceful reload**:
   ```bash
   pm2 reload orchestrator-prod
   ```

## Port Conflict Prevention

### Check for conflicts before starting:
```bash
# Check if ports are in use
lsof -i :3000  # Production server
lsof -i :4000  # Dev server
lsof -i :2080  # Production client
lsof -i :2081  # Dev client
```

### Kill conflicting processes if needed:
```bash
# Find and kill process on specific port
lsof -ti :4000 | xargs -r kill -9
```

## Emergency Recovery

If you accidentally kill production while working:

1. **Quick restart**:
   ```bash
   cd ~/claude-orchestrator
   npm run dev:all &
   ```

2. **Check session recovery**:
   - Sessions should auto-reconnect
   - Check `logs/sessions.log` for issues

3. **Restore from git if needed**:
   ```bash
   git stash  # Save any uncommitted work
   git checkout main
   git pull origin main
   npm install && npm rebuild node-pty
   npm run dev:all
   ```

## Best Practices

1. **Always use branches** in dev instance
2. **Test thoroughly** before deploying to production
3. **Keep production on `main` branch**
4. **Use different terminal windows** for prod vs dev
5. **Set up different colored prompts** to distinguish environments:
   ```bash
   # In dev instance .env:
   TERMINAL_TITLE_PREFIX="[DEV]"
   ```

## Quick Reference

| Instance | Directory | Server Port | Client Port | Tauri Port | Safe to Modify? |
|----------|-----------|-------------|-------------|------------|-----------------|
| Production | ~/claude-orchestrator | 3000 | 2080 | 1420 | ❌ No (while in use) |
| Development | ~/claude-orchestrator-dev | 4000 | 2081 | 1421 | ✅ Yes (always) |