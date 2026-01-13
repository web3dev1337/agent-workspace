/**
 * Session Recovery Service
 * Tracks terminal state (CWD, conversation ID, last command) for recovery after crashes
 *
 * Stores state locally per-workspace in ~/.orchestrator/session-recovery/
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

const RECOVERY_DIR = path.join(process.env.HOME || '', '.orchestrator', 'session-recovery');

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
    this.saveDebounce = null;
    this.initialized = false;
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
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
    }

    this.saveDebounce = setTimeout(async () => {
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
  }

  /**
   * Update session state
   */
  updateSession(workspaceId, sessionId, updates) {
    if (!this.states.has(workspaceId)) {
      this.states.set(workspaceId, new Map());
    }

    const sessions = this.states.get(workspaceId);
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
    this.saveWorkspaceState(workspaceId);

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
  updateAgent(workspaceId, sessionId, agent, mode) {
    return this.updateSession(workspaceId, sessionId, {
      lastAgent: agent,  // 'claude', 'codex', 'opencode', etc.
      lastMode: mode     // 'fresh', 'continue', 'resume'
    });
  }

  /**
   * Mark session as running a server
   */
  updateServer(workspaceId, sessionId, command, port) {
    return this.updateSession(workspaceId, sessionId, {
      lastServerCommand: command,
      lastServerPort: port,
      serverRunning: true
    });
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
   * Looks up conversation IDs by directly checking Claude's projects folder
   */
  async getRecoveryInfo(workspaceId) {
    const state = await this.loadWorkspaceState(workspaceId);
    const sessions = state.sessions || {};
    const fsSync = require('fs');

    // Build recovery info for each session
    const recoveryData = [];
    for (const s of Object.values(sessions)) {
      // Skip if no worktree path
      if (!s.worktreePath && !s.lastServerCommand) {
        continue;
      }

      let conversationId = null;
      let actualCwd = s.worktreePath;  // Default to worktree path

      // For Claude sessions, look up conversation (checks worktree AND parent folder)
      if (s.lastAgent === 'claude' && s.worktreePath) {
        const result = this.getLatestConversation(s.worktreePath);
        if (result) {
          conversationId = result.conversationId;
          actualCwd = result.actualCwd;  // Where Claude was actually started
        }
      }

      recoveryData.push({
        sessionId: s.sessionId,
        lastCwd: actualCwd,  // Actual CWD where Claude was started (may differ from worktree)
        lastAgent: s.lastAgent,
        lastConversationId: conversationId,
        worktreePath: s.worktreePath,
        lastServerCommand: s.lastServerCommand,
        updatedAt: s.updatedAt
      });
    }

    return {
      workspaceId,
      savedAt: state.savedAt,
      totalSessions: Object.keys(sessions).length,
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
      // Convert path to Claude's folder format: /home/<user>/foo → -home-ab-foo
      const folderName = checkPath.replace(/\//g, '-');
      const projectsDir = path.join(process.env.HOME, '.claude', 'projects', folderName);

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
    const sessions = this.states.get(workspaceId);
    if (sessions) {
      sessions.delete(sessionId);
      this.saveWorkspaceState(workspaceId);
    }
  }

  /**
   * Clear all sessions for a workspace
   */
  async clearWorkspace(workspaceId) {
    this.states.delete(workspaceId);
    try {
      const filePath = this.getRecoveryPath(workspaceId);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }
}

// Singleton instance
const sessionRecoveryService = new SessionRecoveryService();

module.exports = sessionRecoveryService;
