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
    this.saveDebounce = new Map();
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
  updateAgent(workspaceId, sessionId, agent, modeOrMeta) {
    const updates = {
      lastAgent: agent  // 'claude', 'codex', 'opencode', etc.
    };

    if (modeOrMeta && typeof modeOrMeta === 'object') {
      Object.assign(updates, modeOrMeta);
    } else if (typeof modeOrMeta === 'string') {
      updates.lastMode = modeOrMeta; // 'fresh', 'continue', 'resume'
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
  async getRecoveryInfo(workspaceId) {
    const state = await this.loadWorkspaceState(workspaceId);
    const sessions = state.sessions || {};
    const fsSync = require('fs');
    const candidateRoots = (cwd) => {
      const roots = [];
      if (cwd) roots.push(cwd);
      if (cwd) roots.push(path.dirname(cwd));
      return roots;
    };

    // Build recovery info for each session - validate conversations exist
    const recoveryData = [];
    for (const s of Object.values(sessions)) {
      // Skip if no worktree path and no server command
      if (!s.worktreePath && !s.lastServerCommand) {
        continue;
      }

      // For Claude sessions, validate the conversation file exists and has content
      let conversationValid = false;
      let conversationCwd = s.lastAgentCwd || s.lastCwd || s.worktreePath;
      if (s.lastAgent === 'claude' && s.lastConversationId && conversationCwd) {
        const roots = [...new Set([
          ...(conversationCwd ? candidateRoots(conversationCwd) : []),
          ...(s.worktreePath ? candidateRoots(s.worktreePath) : [])
        ])];
        for (const root of roots) {
          const folderName = root.replace(/\//g, '-');
          const convPath = path.join(
            process.env.HOME, '.claude', 'projects', folderName,
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

      // Only include Claude sessions with valid conversations
      // Always include server sessions
      if (s.lastAgent === 'claude' && !conversationValid) {
        logger.debug('Skipping session with invalid/empty conversation', {
          sessionId: s.sessionId,
          conversationId: s.lastConversationId
        });
        continue;
      }

      recoveryData.push({
        sessionId: s.sessionId,
        lastCwd: conversationCwd || s.worktreePath,
        lastAgent: s.lastAgent,
        lastConversationId: s.lastConversationId,
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
      // Convert path to Claude's folder format: /home/ab/foo → -home-ab-foo
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
