/**
 * Session Recovery Service
 * Tracks terminal state (CWD, conversation ID, last command) for recovery after crashes
 *
 * Stores state locally per-workspace in ~/.orchestrator/session-recovery/
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { ConversationService } = require('./conversationService');

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
   * Looks up conversation IDs on-demand for each session
   */
  async getRecoveryInfo(workspaceId) {
    const state = await this.loadWorkspaceState(workspaceId);
    const sessions = state.sessions || {};

    // Get conversation index once
    const conversationService = ConversationService.getInstance();
    let conversationIndex = null;
    try {
      conversationIndex = await conversationService.getIndex();
    } catch (e) {
      logger.warn('Could not load conversation index for recovery', { error: e.message });
    }

    // Build recovery info for each session
    const recoveryData = [];
    for (const s of Object.values(sessions)) {
      // Skip if no useful recovery data
      if (!s.lastCwd && !s.worktreePath && !s.lastServerCommand) {
        continue;
      }

      // Look up conversation for this session's path
      let conversationId = s.lastConversationId;
      let conversationCwd = s.lastCwd;

      if (!conversationId && conversationIndex && s.lastAgent === 'claude') {
        // Find most recent conversation for this session's path
        const searchPath = s.lastCwd || s.worktreePath;
        if (searchPath) {
          const matching = conversationIndex.conversations.filter(c => {
            if (!c.cwd) return false;
            // Exact match only - no fuzzy matching
            return c.cwd === searchPath;
          });

          if (matching.length > 0) {
            // Sort by most recent
            matching.sort((a, b) => {
              const timeA = new Date(a.lastTimestamp || 0).getTime();
              const timeB = new Date(b.lastTimestamp || 0).getTime();
              return timeB - timeA;
            });
            conversationId = matching[0].id;
            conversationCwd = matching[0].cwd;
          }
        }
      }

      recoveryData.push({
        sessionId: s.sessionId,
        lastCwd: conversationCwd || s.lastCwd || s.worktreePath,
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
