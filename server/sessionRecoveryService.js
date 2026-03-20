/**
 * Session Recovery Service
 * Tracks terminal state (CWD, conversation ID, last command) for recovery after crashes
 *
 * Stores state locally per-workspace in ~/.agent-workspace/session-recovery/
 */

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const winston = require('winston');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const HOME_DIR = process.env.HOME || os.homedir();
const RECOVERY_DIR = path.join(getAgentWorkspaceDir(), 'session-recovery');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class SessionRecoveryService {
  constructor() {
    this.states = new Map(); // workspaceId -> { sessionId -> state }
    this.saveDebounce = new Map();
    this.initialized = false;
  }

  ensureWorkspaceStateLoadedSync(workspaceId) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return;
    if (this.states.has(ws)) return;

    try {
      const filePath = this.getRecoveryPath(ws);
      const fsSync = require('fs');
      const data = fsSync.readFileSync(filePath, 'utf8');
      const state = JSON.parse(String(data || '{}'));
      this.states.set(ws, new Map(Object.entries(state.sessions || {})));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger.error('Failed to load recovery state (sync)', { workspaceId: ws, error: error.message });
      }
      this.states.set(ws, new Map());
    }
  }

  saveWorkspaceStateSync(workspaceId) {
    try {
      const ws = String(workspaceId || '').trim();
      if (!ws) return;

      const sessions = this.states.get(ws);
      if (!sessions) return;

      const state = {
        workspaceId: ws,
        savedAt: new Date().toISOString(),
        sessions: Object.fromEntries(sessions)
      };

      const filePath = this.getRecoveryPath(ws);
      const fsSync = require('fs');
      fsSync.mkdirSync(RECOVERY_DIR, { recursive: true });
      fsSync.writeFileSync(filePath, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.error('Failed to save recovery state (sync)', { workspaceId, error: error.message });
    }
  }

  async init() {
    try {
      await fs.mkdir(RECOVERY_DIR, { recursive: true });
      this.initialized = true;
      logger.info('Session recovery service initialized', { dir: RECOVERY_DIR });
    } catch (error) {
      logger.error('Failed to initialize session recovery', { error: error.message });
    }
  }

  /**
   * Get the recovery file path for a workspace
   */
  getRecoveryPath(workspaceId) {
    // Sanitize workspace ID for filename
    const safeId = workspaceId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(RECOVERY_DIR, `${safeId}.json`);
  }

  /**
   * Load recovery state for a workspace
   */
  async loadWorkspaceState(workspaceId) {
    try {
      const filePath = this.getRecoveryPath(workspaceId);
      const data = await fs.readFile(filePath, 'utf8');
      const state = JSON.parse(data);
      this.states.set(workspaceId, new Map(Object.entries(state.sessions || {})));
      logger.debug('Loaded recovery state', { workspaceId, sessions: Object.keys(state.sessions || {}).length });
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load recovery state', { workspaceId, error: error.message });
      }
      this.states.set(workspaceId, new Map());
      return { sessions: {}, savedAt: null };
    }
  }

  /**
   * Save recovery state for a workspace (debounced)
   */
  async saveWorkspaceState(workspaceId) {
    const existing = this.saveDebounce.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      this.saveDebounce.delete(workspaceId);
      try {
        const sessions = this.states.get(workspaceId);
        if (!sessions) return;

        const state = {
          workspaceId,
          savedAt: new Date().toISOString(),
          sessions: Object.fromEntries(sessions)
        };

        const filePath = this.getRecoveryPath(workspaceId);
        await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        logger.debug('Saved recovery state', { workspaceId, sessions: sessions.size });
      } catch (error) {
        logger.error('Failed to save recovery state', { workspaceId, error: error.message });
      }
    }, 1000); // Debounce 1 second

    this.saveDebounce.set(workspaceId, timeout);
  }

  /**
   * Update session state
   */
  updateSession(workspaceId, sessionId, updates) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return null;

    this.ensureWorkspaceStateLoadedSync(ws);

    const sessions = this.states.get(ws);
    const current = sessions.get(sessionId) || {
      sessionId,
      createdAt: new Date().toISOString()
    };

    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    sessions.set(sessionId, updated);
    this.saveWorkspaceState(ws);

    return updated;
  }

  /**
   * Update CWD for a session (called when detecting directory change)
   */
  updateCwd(workspaceId, sessionId, cwd) {
    return this.updateSession(workspaceId, sessionId, { lastCwd: cwd });
  }

  /**
   * Update conversation ID for a session
   */
  updateConversation(workspaceId, sessionId, conversationId, conversationPath) {
    return this.updateSession(workspaceId, sessionId, {
      lastConversationId: conversationId,
      lastConversationPath: conversationPath
    });
  }

  /**
   * Update running process/agent for a session
   */
  updateAgent(workspaceId, sessionId, agent, modeOrMeta) {
    const updates = {
      lastAgent: agent,  // 'claude', 'codex', 'opencode', etc.
      lastAgentActive: true
    };

    if (modeOrMeta && typeof modeOrMeta === 'object') {
      Object.assign(updates, modeOrMeta);
    } else if (typeof modeOrMeta === 'string') {
      updates.lastMode = modeOrMeta; // 'fresh', 'continue', 'resume'
    }

    return this.updateSession(workspaceId, sessionId, updates);
  }

  /**
   * Clear agent-specific recovery markers when a terminal returns to plain shell.
   */
  clearAgent(workspaceId, sessionId) {
    return this.updateSession(workspaceId, sessionId, {
      lastAgent: null,
      lastAgentActive: false,
      lastMode: null,
      lastAgentCommand: null,
      lastAgentCwd: null,
      lastConversationId: null,
      lastConversationPath: null
    });
  }

  /**
   * Mark agent as inactive without losing the last agent metadata.
   * Keeps recovery info intact while allowing the UI to show "no agent".
   */
  markAgentInactive(workspaceId, sessionId, meta = null) {
    const updates = {
      lastAgentActive: false
    };
    if (meta && typeof meta === 'object') {
      Object.assign(updates, meta);
    }
    return this.updateSession(workspaceId, sessionId, updates);
  }

  /**
   * Mark session as running a server
   */
  updateServer(workspaceId, sessionId, command, portOrMeta) {
    const updates = {
      lastServerCommand: command,
      serverRunning: true
    };

    if (portOrMeta && typeof portOrMeta === 'object') {
      Object.assign(updates, portOrMeta);
    } else if (portOrMeta !== undefined) {
      updates.lastServerPort = portOrMeta;
    }

    return this.updateSession(workspaceId, sessionId, updates);
  }

  /**
   * Get session state for recovery
   */
  getSession(workspaceId, sessionId) {
    const sessions = this.states.get(workspaceId);
    return sessions?.get(sessionId) || null;
  }

  /**
   * Get all sessions for a workspace
   */
  getAllSessions(workspaceId) {
    const sessions = this.states.get(workspaceId);
    return sessions ? Object.fromEntries(sessions) : {};
  }

  /**
   * Get recovery info for display
   * Validates that conversation files exist and have content before including
   */
  async getRecoveryInfo(workspaceId, { allowSessionIds = null, pruneMissing = false } = {}) {
    const state = await this.loadWorkspaceState(workspaceId);
    const sessions = state.sessions || {};
    const allowSet = Array.isArray(allowSessionIds) ? new Set(allowSessionIds.map(s => String(s || '').trim()).filter(Boolean)) : null;
    const fsSync = require('fs');
    const candidateRoots = (cwd) => {
      const roots = [];
      if (cwd) roots.push(cwd);
      if (cwd) roots.push(path.dirname(cwd));
      return roots;
    };

    // If a workspace has changed its terminal list, session recovery can accumulate stale entries.
    // Filter (and optionally prune) to only sessions still present in the workspace config.
    const allEntries = Object.entries(sessions);
    const allowedEntries = allowSet
      ? allEntries.filter(([id]) => allowSet.has(String(id || '').trim()))
      : allEntries;
    if (allowSet) {
      const stale = allEntries
        .map(([id]) => String(id || '').trim())
        .filter((id) => id && !allowSet.has(id));
      if (stale.length && pruneMissing) {
        try {
          const map = this.states.get(workspaceId);
          if (map) {
            stale.forEach((id) => map.delete(id));
            this.saveWorkspaceState(workspaceId);
          }
        } catch {
          // best-effort
        }
      }
    }

    // Build recovery info for each session - validate conversations exist
    const recoveryData = [];
    for (const [id, s0] of allowedEntries) {
      const sid = String(id || '').trim();
      const s = s0 || {};
      // Only include sessions that have meaningful recovery state. A bare worktreePath (seeded on session creation)
      // is not actionable and creates noisy "recoverable session" prompts after restarts.
      if (!s.lastAgent && !s.lastServerCommand) continue;

      // For Claude sessions, validate the conversation file exists and has content
      let conversationValid = false;
      let conversationCwd = s.lastAgentCwd || s.lastCwd || s.worktreePath;
      if (s.lastAgent === 'claude' && s.lastConversationId && conversationCwd) {
        const roots = [...new Set([
          ...(conversationCwd ? candidateRoots(conversationCwd) : []),
          ...(s.worktreePath ? candidateRoots(s.worktreePath) : [])
        ])];
        for (const root of roots) {
          const folderName = String(root || '').replace(/[\\/]/g, '-');
          const convPath = path.join(
            HOME_DIR, '.claude', 'projects', folderName,
            `${s.lastConversationId}.jsonl`
          );
          try {
            const stats = fsSync.statSync(convPath);
            if (stats.size > 0) {
              conversationValid = true;
              conversationCwd = root;
              break;
            }
          } catch (error) {
            // Ignore missing files
          }
        }
      }

      const safeConversationId = (s.lastAgent === 'claude' && conversationValid)
        ? s.lastConversationId
        : null;
      if (s.lastAgent === 'claude' && !conversationValid) {
        logger.debug('Recovery session missing valid conversation, falling back to continue', {
          sessionId: s.sessionId,
          conversationId: s.lastConversationId
        });
      }

      recoveryData.push({
        sessionId: s.sessionId,
        lastCwd: conversationCwd || s.worktreePath,
        lastAgent: s.lastAgent,
        lastMode: s.lastMode,
        lastConversationId: safeConversationId,
        worktreePath: s.worktreePath,
        lastServerCommand: s.lastServerCommand,
        updatedAt: s.updatedAt
      });
    }

    return {
      workspaceId,
      savedAt: state.savedAt,
      totalSessions: allowedEntries.length,
      recoverableSessions: recoveryData.length,
      sessions: recoveryData
    };
  }

  /**
   * Get the latest conversation ID for a worktree path
   * Checks both the worktree path AND its parent (user may have cd'd up)
   * Returns { conversationId, actualCwd } where actualCwd is where Claude was started
   */
  getLatestConversation(worktreePath) {
    const fsSync = require('fs');

    // Paths to check: worktree path and its parent (user may have cd'd up)
    const parentPath = path.dirname(worktreePath);
    const pathsToCheck = [worktreePath, parentPath];

    let bestMatch = null;
    let bestMtime = 0;

    for (const checkPath of pathsToCheck) {
      // Convert path to Claude's folder format: $HOME/foo → -home-user-foo
      const folderName = String(checkPath || '').replace(/[\\/]/g, '-');
      const projectsDir = path.join(HOME_DIR, '.claude', 'projects', folderName);

      try {
        if (!fsSync.existsSync(projectsDir)) {
          continue;
        }

        // Get all .jsonl files that have content (size > 0)
        const files = fsSync.readdirSync(projectsDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => {
            const fullPath = path.join(projectsDir, f);
            const stats = fsSync.statSync(fullPath);
            return {
              name: f,
              mtime: stats.mtime.getTime(),
              size: stats.size
            };
          })
          .filter(f => f.size > 0);  // Only files with actual content

        for (const file of files) {
          if (file.mtime > bestMtime) {
            bestMtime = file.mtime;
            bestMatch = {
              conversationId: file.name.replace('.jsonl', ''),
              actualCwd: checkPath  // The path where this conversation was started
            };
          }
        }
      } catch (error) {
        logger.debug('Could not check path for conversations', { checkPath, error: error.message });
      }
    }

    return bestMatch;
  }

  /**
   * Clear session state (e.g., when workspace is closed normally)
   */
  clearSession(workspaceId, sessionId) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return;

    this.ensureWorkspaceStateLoadedSync(ws);
    const sessions = this.states.get(ws);
    if (!sessions) return;

    sessions.delete(sessionId);

    // Clear any pending debounced write and persist immediately, so explicit user closes
    // don't keep showing up as "recoverable" if the server exits soon after.
    const existing = this.saveDebounce.get(ws);
    if (existing) {
      clearTimeout(existing);
      this.saveDebounce.delete(ws);
    }

    this.saveWorkspaceStateSync(ws);
  }

  /**
   * Clear all sessions for a workspace
   */
  async clearWorkspace(workspaceId) {
    this.states.delete(workspaceId);
    const existing = this.saveDebounce.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
      this.saveDebounce.delete(workspaceId);
    }
    try {
      const filePath = this.getRecoveryPath(workspaceId);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Prune recovery entries older than a cutoff (best-effort hygiene).
   * Returns number of pruned sessions.
   */
  pruneOlderThan(workspaceId, { olderThanMs } = {}) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return 0;

    const cutoffMs = Number(olderThanMs);
    if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) return 0;

    this.ensureWorkspaceStateLoadedSync(ws);
    const sessions = this.states.get(ws);
    if (!sessions || sessions.size === 0) return 0;

    const cutoff = Date.now() - cutoffMs;
    let pruned = 0;

    for (const [sid, s0] of sessions.entries()) {
      const s = s0 || {};
      const ts =
        Date.parse(String(s.updatedAt || '')) ||
        Date.parse(String(s.createdAt || '')) ||
        0;
      if (!ts || ts < cutoff) {
        sessions.delete(sid);
        pruned += 1;
      }
    }

    if (pruned > 0) {
      const existing = this.saveDebounce.get(ws);
      if (existing) {
        clearTimeout(existing);
        this.saveDebounce.delete(ws);
      }
      this.saveWorkspaceStateSync(ws);
    }

    return pruned;
  }
}

// Singleton instance
const sessionRecoveryService = new SessionRecoveryService();

module.exports = sessionRecoveryService;
module.exports.SessionRecoveryService = SessionRecoveryService;
