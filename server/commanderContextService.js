const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/commander-context.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const shallowClean = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return null;
};

class CommanderContextService {
  constructor() {
    this.state = {
      updatedAt: null,
      source: null,
      socketId: null,
      context: {}
    };
  }

  static getInstance() {
    if (!CommanderContextService.instance) {
      CommanderContextService.instance = new CommanderContextService();
    }
    return CommanderContextService.instance;
  }

  setContext(context, { source = 'unknown', socketId = null } = {}) {
    const next = (context && typeof context === 'object') ? context : {};

    // Only keep fields we expect and keep them bounded.
    const cleaned = {};
    cleaned.currentWorkspace = shallowClean(next.currentWorkspace);
    cleaned.currentWorktree = shallowClean(next.currentWorktree);
    cleaned.activeSession = shallowClean(next.activeSession);

    if (Array.isArray(next.workspaces)) {
      cleaned.workspaces = next.workspaces.map(shallowClean).filter(Boolean).slice(0, 200);
    }
    if (Array.isArray(next.worktrees)) {
      cleaned.worktrees = next.worktrees.map(shallowClean).filter(Boolean).slice(0, 400);
    }
    if (Array.isArray(next.worktreeDetails)) {
      cleaned.worktreeDetails = next.worktreeDetails
        .map((w) => ({
          id: shallowClean(w?.id),
          branch: shallowClean(w?.branch)
        }))
        .filter((w) => w.id)
        .slice(0, 400);
    }

    if (next.selectedQueue && typeof next.selectedQueue === 'object') {
      cleaned.selectedQueue = {
        id: shallowClean(next.selectedQueue.id),
        kind: shallowClean(next.selectedQueue.kind),
        title: shallowClean(next.selectedQueue.title),
        url: shallowClean(next.selectedQueue.url),
        sessionId: shallowClean(next.selectedQueue.sessionId),
        worktreePath: shallowClean(next.selectedQueue.worktreePath)
      };
    } else {
      cleaned.selectedQueue = null;
    }

    this.state = {
      updatedAt: new Date().toISOString(),
      source: String(source || 'unknown'),
      socketId: socketId ? String(socketId) : null,
      context: cleaned
    };
  }

  getSnapshot({ workspaceManager, commanderService, commandRegistry } = {}) {
    const workspaces = (() => {
      try {
        const ws = workspaceManager?.listWorkspaces?.() || [];
        return Array.isArray(ws) ? ws.map(w => ({ id: w.id, name: w.name, type: w.workspaceType || w.type || null })) : [];
      } catch {
        return [];
      }
    })();

    const activeWorkspace = (() => {
      try {
        const a = workspaceManager?.getActiveWorkspace?.() || null;
        return a ? { id: a.id, name: a.name, type: a.workspaceType || a.type || null } : null;
      } catch {
        return null;
      }
    })();

    const sessions = (() => {
      try {
        return commanderService?.listSessions?.() || [];
      } catch {
        return [];
      }
    })();

    const capabilities = (() => {
      try {
        return commandRegistry?.getCapabilities?.() || {};
      } catch {
        return {};
      }
    })();

    return {
      ...this.state,
      computed: {
        activeWorkspace,
        workspaces,
        sessions,
        capabilitiesSummary: {
          categories: Object.keys(capabilities || {}).sort(),
          commandCount: Object.values(capabilities || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
        }
      }
    };
  }
}

module.exports = { CommanderContextService };

