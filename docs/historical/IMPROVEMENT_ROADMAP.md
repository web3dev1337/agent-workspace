# Claude Orchestrator - Comprehensive Improvement Roadmap

Generated: 2026-01-11

## Executive Summary

Based on extensive codebase analysis, this document outlines a prioritized roadmap to transform the Claude Orchestrator from a functional multi-terminal manager into a unified AI development command center.

---

## Current Pain Points (Prioritized)

### P0 - Critical (Blocking Daily Work)

| Issue | Impact | Root Cause |
|-------|--------|------------|
| **No Greenfield Project Workflow** | Can't easily start new projects, hard to resume later | No standardized project creation wizard |
| **Console Log Spam** | Performance degradation, hard to debug | Excessive logging in hot paths, no log levels in client |
| **Cascaded Config Broken** | Buttons/settings don't work per-project | Config merging bugs, cache mutation issues |
| **No Top-Level Claude** | Can't orchestrate across all terminals | No central command interface |

### P1 - High (Major Friction)

| Issue | Impact | Root Cause |
|-------|--------|------------|
| **Session Recovery Failures** | Terminals don't recover after crashes | Claude/Codex selector appears incorrectly |
| **False Positive Notifications** | Sounds trigger when agents aren't done | Status detection patterns too broad |
| **Port Conflicts** | Multiple projects fight for same ports | No port registry/management |
| **No Quick Links Dashboard** | Easy to get lost across repos/services | No favorites/bookmarks system |

### P2 - Medium (Quality of Life)

| Issue | Impact | Root Cause |
|-------|--------|------------|
| **No Voice Commands** | Have to type everything | No speech recognition integration |
| **No Skills/Tools Library** | Repeat same instructions | No reusable prompt templates |
| **Refresh/Restart Broken** | Buttons don't work reliably | Incomplete session lifecycle handling |

---

## Architecture Overview

```
CURRENT STATE:
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator UI                          │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐       │
│  │ Term 1  │ Term 2  │ Term 3  │ Term 4  │  ...    │       │
│  │ (Claude)│ (Server)│ (Claude)│ (Server)│         │       │
│  └─────────┴─────────┴─────────┴─────────┴─────────┘       │
│                         │                                   │
│           Socket.IO Connection (per terminal)               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                    Node.js Backend                          │
│  SessionManager → PTY processes → Terminal output           │
└─────────────────────────────────────────────────────────────┘

PROPOSED STATE:
┌─────────────────────────────────────────────────────────────┐
│                 COMMANDER (Top-Level Claude)                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Voice Input → Speech Recognition → Claude API      │   │
│  │  "Create new project called MyApp"                  │   │
│  │  "Switch to work3 on HyFire"                        │   │
│  │  "Run tests on all active terminals"                │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                    DASHBOARD                                │
│  ┌──────────┬──────────┬──────────┬──────────────────────┐ │
│  │ Projects │ Services │ Links    │ Recent Sessions      │ │
│  │ (repos)  │ (ports)  │ (favs)   │ (resumable)          │ │
│  └──────────┴──────────┴──────────┴──────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                 WORKSPACE TABS                              │
│  [HyFire] [Epic Survivors] [New Project] [+]               │
├─────────────────────────────────────────────────────────────┤
│                    TERMINAL GRID                            │
│  ┌─────────┬─────────┬─────────┬─────────┐                 │
│  │ work1   │ work1   │ work2   │ work2   │                 │
│  │ claude  │ server  │ claude  │ server  │                 │
│  └─────────┴─────────┴─────────┴─────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Solution Designs

### 1. Greenfield Project Wizard

**Goal:** One-click project creation with full setup

**UI Flow:**
```
[+ New Project] button
    ↓
┌─────────────────────────────────────────┐
│         Create New Project              │
├─────────────────────────────────────────┤
│ Project Name: [________________]        │
│                                         │
│ Type: ○ Hytopia Game                    │
│       ○ MonoGame Project                │
│       ○ Website (Rails/Next/etc)        │
│       ○ CLI Tool                        │
│       ○ Other                           │
│                                         │
│ Location: ~/GitHub/[games/websites/...] │
│                                         │
│ GitHub: ○ Public  ○ Private  ○ None     │
│                                         │
│ Worktrees: [8] (default)                │
│                                         │
│ [Create Project]                        │
└─────────────────────────────────────────┘
```

**Backend Flow:**
```javascript
async createGreenFieldProject(config) {
  // 1. Create directory structure
  const projectPath = path.join(config.basePath, config.name);
  await fs.mkdir(path.join(projectPath, 'master'), { recursive: true });

  // 2. Initialize git
  await exec(`cd ${projectPath}/master && git init`);

  // 3. Create initial files based on type
  await this.scaffoldProject(projectPath, config.type);

  // 4. Create GitHub repo if requested
  if (config.github !== 'none') {
    const visibility = config.github === 'public' ? '--public' : '--private';
    await exec(`cd ${projectPath}/master && gh repo create ${config.name} ${visibility} --source=. --push`);
  }

  // 5. Create worktrees
  for (let i = 1; i <= config.worktreeCount; i++) {
    await exec(`cd ${projectPath}/master && git worktree add ../work${i} -b work${i}`);
  }

  // 6. Create workspace config
  const workspace = await workspaceManager.createWorkspace({
    name: config.name,
    type: config.type,
    repository: { path: projectPath, masterBranch: 'master' },
    terminals: { pairs: config.worktreeCount }
  });

  // 7. Save to recent projects for easy resume
  await this.addToRecentProjects(workspace);

  return workspace;
}
```

**Key Files to Create:**
- `server/greenFieldService.js` - Project scaffolding logic
- `client/greenfield-wizard.js` - UI wizard
- `templates/scaffolds/` - Per-type project templates

---

### 2. Console Log Reduction

**Current Problem:**
```javascript
// These fire on EVERY terminal output character
console.log('Terminal output:', data);
console.log('Status update:', status);
console.log('Branch update:', branch);
```

**Solution - Log Levels:**

```javascript
// server/logger.js - Add log level filtering
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// Environment variable controls what gets logged
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

// Replace console.log with conditional logging
logger.debug('Terminal output:', data);  // Only shows if LOG_LEVEL=debug
logger.trace('Every character:', char);   // Only shows if LOG_LEVEL=trace
```

**Client-Side Fix:**
```javascript
// client/app.js - Remove hot path logging
this.socket.on('terminal-output', ({ sessionId, data }) => {
  // REMOVE: console.log('Received output for:', sessionId);
  this.terminalManager.handleOutput(sessionId, data);
});
```

**Files to Modify:**
- `server/index.js` - Replace console.log with logger.debug/trace
- `server/sessionManager.js` - Reduce output logging
- `client/app.js` - Remove hot path console.logs
- `.env` - Add LOG_LEVEL=info (default)

---

### 3. Fix Cascaded Config System

**Current Bug Location:** `server/workspaceManager.js:238`

**Problem:**
```javascript
// BUG: Shallow spread doesn't deep clone
result[key] = { ...base[key], ...override[key] };
// If base[key] has nested objects, they get mutated!
```

**Fix:**
```javascript
// CORRECT: Deep clone before merging
mergeConfigs(base, override) {
  // Always start with deep clone to prevent cache mutation
  const result = JSON.parse(JSON.stringify(base));

  for (const key in override) {
    if (override[key] === undefined) continue;

    if (key === 'buttons') {
      // Deep merge buttons per terminal type
      result.buttons = result.buttons || {};
      for (const termType in override.buttons) {
        result.buttons[termType] = {
          ...(result.buttons[termType] || {}),
          ...override.buttons[termType]
        };
      }
    } else if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = this.mergeConfigs(result[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }

  return result;
}
```

**Also Fix:** Config cache invalidation when files change
```javascript
// Add file watcher for .orchestrator-config.json files
const configWatcher = chokidar.watch('**/.orchestrator-config.json', {
  ignored: /node_modules/,
  persistent: true
});

configWatcher.on('change', (path) => {
  logger.info('Config file changed, invalidating cache', { path });
  this.configCache.delete(path);
});
```

---

### 4. Top-Level Claude (Commander)

**Concept:** A persistent Claude session that can see and control everything

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    COMMANDER CLAUDE                         │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ System Prompt:                                        │ │
│  │ "You are the Commander of the Claude Orchestrator.    │ │
│  │  You have access to:                                  │ │
│  │  - All workspace configurations                       │ │
│  │  - All running terminal sessions                      │ │
│  │  - Port registry                                      │ │
│  │  - Project creation tools                             │ │
│  │  - GitHub integration                                 │ │
│  │                                                       │ │
│  │  Available commands:                                  │ │
│  │  /create-project <name> <type>                        │ │
│  │  /switch-workspace <name>                             │ │
│  │  /send-to <terminal> <message>                        │ │
│  │  /check-ports                                         │ │
│  │  /run-on-all <command>                                │ │
│  │  ..."                                                 │ │
│  └───────────────────────────────────────────────────────┘ │
│                         │                                   │
│                    Claude API                               │
│                         │                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Tool Calls:                                           │ │
│  │ - createProject(config)                               │ │
│  │ - switchWorkspace(id)                                 │ │
│  │ - sendToTerminal(sessionId, input)                    │ │
│  │ - getTerminalOutput(sessionId)                        │ │
│  │ - listPorts()                                         │ │
│  │ - reservePort(port, description)                      │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```javascript
// server/commanderService.js
class CommanderService {
  constructor(anthropicApiKey) {
    this.client = new Anthropic({ apiKey: anthropicApiKey });
    this.conversationHistory = [];
  }

  async processCommand(userInput) {
    const tools = [
      {
        name: 'create_project',
        description: 'Create a new greenfield project',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['hytopia-game', 'website', 'cli-tool'] },
            github: { type: 'string', enum: ['public', 'private', 'none'] }
          }
        }
      },
      {
        name: 'switch_workspace',
        description: 'Switch to a different workspace',
        input_schema: {
          type: 'object',
          properties: {
            workspaceId: { type: 'string' }
          }
        }
      },
      // ... more tools
    ];

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: COMMANDER_SYSTEM_PROMPT,
      tools,
      messages: [...this.conversationHistory, { role: 'user', content: userInput }]
    });

    // Execute tool calls
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        await this.executeTool(block.name, block.input);
      }
    }

    return response;
  }
}
```

---

### 5. Port Registry System

**Goal:** Track all ports across projects to prevent conflicts

**Data Structure:**
```javascript
// ~/.orchestrator/port-registry.json
{
  "reserved": {
    "3000": { "description": "Orchestrator (NEVER KILL)", "permanent": true },
    "3001": { "description": "Orchestrator Dev", "permanent": true }
  },
  "active": {
    "8001": { "project": "HyFire2", "worktree": "work1", "pid": 12345, "startedAt": "..." },
    "8002": { "project": "HyFire2", "worktree": "work2", "pid": 12346, "startedAt": "..." }
  },
  "assignments": {
    "hytopia-game": { "basePort": 8000, "pattern": "basePort + worktreeNumber" },
    "website": { "basePort": 4000, "pattern": "basePort + worktreeNumber" }
  }
}
```

**API:**
```javascript
class PortRegistry {
  getNextAvailablePort(projectType) {
    const assignment = this.assignments[projectType];
    const usedPorts = Object.keys(this.active).map(Number);

    for (let i = 1; i <= 100; i++) {
      const port = assignment.basePort + i;
      if (!usedPorts.includes(port) && !this.reserved[port]) {
        return port;
      }
    }
    throw new Error('No available ports');
  }

  registerPort(port, info) {
    this.active[port] = { ...info, startedAt: new Date().toISOString() };
    this.save();
  }

  releasePort(port) {
    delete this.active[port];
    this.save();
  }
}
```

---

### 6. Quick Links Dashboard

**UI Component:**
```
┌─────────────────────────────────────────────────────────────┐
│                    QUICK LINKS DASHBOARD                    │
├───────────────┬───────────────┬───────────────┬─────────────┤
│ PROJECTS      │ SERVICES      │ FAVORITES     │ RECENT      │
├───────────────┼───────────────┼───────────────┼─────────────┤
│ □ HyFire2     │ ● :3000 Orch  │ ★ GitHub      │ work3 claude│
│   work1-8     │ ● :8001 Game  │ ★ Trello      │ 2 hrs ago   │
│ □ EpicSurv    │ ○ :4444 Web   │ ★ Figma       │             │
│   work1-6     │               │ ★ Notion      │ work1 server│
│ □ Zoo Game    │ [+ Add Port]  │               │ 3 hrs ago   │
│   work1-8     │               │ [+ Add Link]  │             │
│               │               │               │ [View All]  │
│ [+ New Proj]  │               │               │             │
└───────────────┴───────────────┴───────────────┴─────────────┘
```

**Data Storage:**
```javascript
// ~/.orchestrator/quick-links.json
{
  "favorites": [
    { "name": "GitHub", "url": "https://github.com", "icon": "github" },
    { "name": "Trello", "url": "https://trello.com", "icon": "trello" }
  ],
  "recentSessions": [
    { "workspaceId": "...", "sessionId": "work3-claude", "lastAccess": "...", "resumePath": "..." }
  ]
}
```

---

### 7. Claude Session Detection Improvements

**Current Problem:** False positives in status detection

**Current Patterns (statusDetector.js):**
```javascript
// Too broad - matches during output, not just prompts
const WAITING_PATTERNS = [
  /\$ $/,           // Shell prompt
  />>> $/,          // Python REPL
  /> $/             // Generic prompt - TOO BROAD!
];
```

**Improved Detection:**
```javascript
// Use Claude Code's actual state files
const CLAUDE_STATE_PATH = path.join(os.homedir(), '.claude', 'projects');

async getClaudeSessionState(worktreePath) {
  // Claude Code stores session state in ~/.claude/projects/{hash}/
  const projectHash = this.hashPath(worktreePath);
  const statePath = path.join(CLAUDE_STATE_PATH, projectHash, 'state.json');

  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return state.status; // 'idle', 'running', 'waiting_for_input'
  } catch {
    // Fall back to terminal pattern matching
    return this.detectFromTerminalOutput();
  }
}

// Also watch for Claude's actual completion signals
const CLAUDE_DONE_PATTERNS = [
  /Cost: \$[\d.]+.*tokens/,  // Claude shows cost when done
  /I've completed/,           // Common completion phrase
  /Let me know if/,           // Waiting for user
  /\n\n> $/                   // Claude's actual prompt (with newlines)
];
```

---

### 8. Voice Commands Integration

**Using Web Speech API:**
```javascript
// client/voice-commands.js
class VoiceCommandManager {
  constructor(commander) {
    this.commander = commander;
    this.recognition = new webkitSpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.lang = 'en-US';
  }

  start() {
    this.recognition.onresult = async (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      console.log('Voice command:', transcript);

      // Send to Commander Claude for interpretation
      const response = await this.commander.processCommand(transcript);

      // Speak response back
      this.speak(response.text);
    };

    this.recognition.start();
  }

  speak(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}
```

**Voice-Enabled Commands:**
- "Create a new Hytopia game called SpaceShooter"
- "Switch to work three on HyFire"
- "What's running on port eight thousand?"
- "Commit and push work one"
- "Run tests on all Claude sessions"

---

## Implementation Roadmap

### Phase 1: Stability (Week 1)
- ✅ Fix cascaded config merging (prevents cache mutation)
- ✅ Reduce console log spam (LOG_LEVEL filtering + fewer hot-path logs)
- ✅ Fix false positive notifications (status detection + hysteresis improvements)
- ⚠️ Refresh/restart buttons: partially shipped (remaining edge-cases tracked in newer plans)

### Phase 2: Core Features (Week 2-3)
- ✅ Implement Port Registry system
- ✅ Add Quick Links Dashboard
- ✅ Create Greenfield Project Wizard
- ✅ Improve session recovery

### Phase 3: Commander (Week 4-5)
- ✅ Implement Commander service (CLI-driven)
- ⏭️ Claude API integration: deferred (CLI-first approach; optional future)
- ✅ Create tool definitions / command registry
- ✅ Build Commander UI panel

### Phase 4: Polish (Week 6)
- ✅ Add Voice Commands (rule-based voice → command registry)
- ✅ Skills/Templates library (skills folder + installer/creator)
- ✅ Performance optimization
- ✅ Documentation

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `server/commanderService.js` | Top-level Claude orchestration |
| `server/portRegistry.js` | Port conflict management |
| `server/greenFieldService.js` | Project scaffolding |
| `client/commander-panel.js` | Commander UI |
| `client/quick-links.js` | Dashboard component |
| `client/voice-commands.js` | Speech recognition |
| `templates/scaffolds/` | Project type templates |

### Modifications
| File | Changes |
|------|---------|
| `server/index.js` | Add Commander endpoints, reduce logging |
| `server/workspaceManager.js` | Fix config merging, add watcher |
| `server/statusDetector.js` | Improve Claude detection patterns |
| `client/app.js` | Remove hot-path logging, add Commander |
| `.env.example` | Add LOG_LEVEL, ANTHROPIC_API_KEY |

---

## Success Metrics

1. **Greenfield Time**: < 30 seconds from "New Project" to first Claude prompt
2. **Console Logs**: < 10 lines per minute in normal operation
3. **Config Accuracy**: Buttons appear correctly per project type
4. **False Positives**: < 1 false "done" notification per hour
5. **Port Conflicts**: Zero conflicts with port registry
6. **Voice Response**: < 3 seconds from speech to action

---

## Open Questions

1. Should Commander Claude use Claude Sonnet or Claude Opus?
2. Should voice commands require a wake word ("Hey Claude")?
3. Should the port registry auto-detect ports from running processes?
4. How should we handle workspace state across machine restarts?
5. Should recent sessions show full conversation or just last message?

---

## Key Insight: Multi-Project Workspaces

**Important:** A workspace can have 8 worktrees, each working on a DIFFERENT project/task:

```
Workspace: "HyFire Development"
├── work1 → Feature: New weapon system
├── work2 → Bugfix: Player collision
├── work3 → Experiment: AI pathfinding
├── work4 → Docs: API reference
├── work5 → (available)
├── work6 → Greenfield: Totally different project!
├── work7 → (available)
├── work8 → (available)
```

This means:
- **Each worktree needs its own ledger** (session continuity)
- **Dashboard shows per-worktree status**, not per-workspace
- **Recent sessions are per-worktree**
- **Greenfield projects can be started in any available worktree**

---

## Integration: Continuous-Claude-Lite

### Existing System
Located at: `~/GitHub/tools/continuous-claude-lite/`

Provides:
- **Ledgers** (`thoughts/ledgers/CONTINUITY_CLAUDE-*.md`) - Session state per worktree
- **Handoffs** (`thoughts/shared/handoffs/`) - Transfer work between sessions
- **Auto-handoffs** - Created before context compaction
- **Hooks** - Automatic loading on session start/resume

### Integration Plan

**1. Read Ledgers in Orchestrator:**
```javascript
// server/continuityService.js
class ContinuityService {
  async getWorktreeLedger(worktreePath) {
    const ledgerPath = path.join(worktreePath, 'thoughts/ledgers');
    const files = await fs.readdir(ledgerPath);
    const ledger = files.find(f => f.startsWith('CONTINUITY_CLAUDE'));

    if (ledger) {
      const content = await fs.readFile(path.join(ledgerPath, ledger), 'utf8');
      return this.parseLedger(content);
    }
    return null;
  }

  parseLedger(content) {
    // Extract: Goal, Current State, Next Steps
    return {
      goal: this.extractSection(content, 'Goal'),
      currentState: this.extractSection(content, 'Current State'),
      nextSteps: this.extractSection(content, 'Next Steps'),
      lastUpdated: this.extractDate(content)
    };
  }
}
```

**2. Show in Orchestrator UI:**
```
┌─────────────────────────────────────────────────────────────┐
│ work1 - claude                           [feature/weapons]  │
├─────────────────────────────────────────────────────────────┤
│ GOAL: Implement new weapon system                           │
│ STATE: Added base weapon class, working on projectiles      │
│ NEXT: Add particle effects, test with player                │
│ Last active: 2 hours ago                                    │
└─────────────────────────────────────────────────────────────┘
```

**3. Auto-Create Structure for New Worktrees:**
```javascript
async initializeWorktreeContinuity(worktreePath) {
  const thoughtsDir = path.join(worktreePath, 'thoughts');
  await fs.mkdir(path.join(thoughtsDir, 'ledgers'), { recursive: true });
  await fs.mkdir(path.join(thoughtsDir, 'shared/handoffs'), { recursive: true });
  await fs.mkdir(path.join(thoughtsDir, 'shared/plans'), { recursive: true });

  // Copy hooks from continuous-claude-lite template
  await this.copyHooks(worktreePath);
}
```

**4. Dashboard "Recent Work" from Ledgers:**
```javascript
async getRecentWork() {
  const allLedgers = [];

  for (const workspace of this.workspaces) {
    for (const worktree of workspace.worktrees) {
      const ledger = await this.getWorktreeLedger(worktree.path);
      if (ledger) {
        allLedgers.push({
          workspace: workspace.name,
          worktree: worktree.id,
          ...ledger
        });
      }
    }
  }

  // Sort by lastUpdated, most recent first
  return allLedgers.sort((a, b) => b.lastUpdated - a.lastUpdated);
}
```

### Benefits
- **No more "what was I working on?"** - Ledger tells you
- **Easy resume** - Click worktree, ledger loads automatically
- **Cross-session persistence** - Survives crashes, restarts
- **Per-worktree context** - 8 independent projects per workspace

---

*This roadmap is a living document. Update as implementation progresses.*
