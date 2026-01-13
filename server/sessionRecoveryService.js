const fs = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/session-recovery.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class SessionRecoveryService {
  constructor() {
    this.configPath = path.join(os.homedir(), '.orchestrator');
    this.sessionStatesPath = path.join(this.configPath, 'session-states');
    this.sessionsByWorkspace = new Map();
    this.loadedWorkspaces = new Set();
    this.pendingSaves = new Map();

    this.ensureDirectories();
  }

  static getInstance() {
    if (!SessionRecoveryService.instance) {
      SessionRecoveryService.instance = new SessionRecoveryService();
    }
    return SessionRecoveryService.instance;
  }

  ensureDirectories() {
    try {
      fs.mkdirSync(this.sessionStatesPath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create session recovery directory', { error: error.message });
    }
  }

  getWorkspaceFile(workspaceId) {
    return path.join(this.sessionStatesPath, `${workspaceId}.json`);
  }

  loadWorkspace(workspaceId) {
    if (!workspaceId || this.loadedWorkspaces.has(workspaceId)) return;

    const filePath = this.getWorkspaceFile(workspaceId);
    let sessions = new Map();

    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sessions && typeof parsed.sessions === 'object') {
          sessions = new Map(Object.entries(parsed.sessions));
        }
      }
    } catch (error) {
      logger.warn('Failed to load session recovery file', { workspaceId, error: error.message });
    }

    this.sessionsByWorkspace.set(workspaceId, sessions);
    this.loadedWorkspaces.add(workspaceId);
  }

  scheduleSave(workspaceId) {
    if (!workspaceId || this.pendingSaves.has(workspaceId)) return;

    const timeout = setTimeout(() => {
      this.pendingSaves.delete(workspaceId);
      this.saveWorkspace(workspaceId);
    }, 300);

    this.pendingSaves.set(workspaceId, timeout);
  }

  saveWorkspace(workspaceId) {
    if (!workspaceId) return;
    const sessions = this.sessionsByWorkspace.get(workspaceId) || new Map();
    const filePath = this.getWorkspaceFile(workspaceId);

    const payload = {
      workspaceId,
      savedAt: new Date().toISOString(),
      sessions: Object.fromEntries(sessions)
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    } catch (error) {
      logger.error('Failed to save session recovery file', { workspaceId, error: error.message });
    }
  }

  getSession(workspaceId, sessionId) {
    if (!workspaceId || !sessionId) return null;
    this.loadWorkspace(workspaceId);
    return this.sessionsByWorkspace.get(workspaceId)?.get(sessionId) || null;
  }

  getWorkspaceSessions(workspaceId) {
    if (!workspaceId) return {};
    this.loadWorkspace(workspaceId);
    const sessions = this.sessionsByWorkspace.get(workspaceId) || new Map();
    return Object.fromEntries(sessions);
  }

  updateSession(workspaceId, sessionId, updates = {}) {
    if (!workspaceId || !sessionId) return;
    this.loadWorkspace(workspaceId);

    const sessions = this.sessionsByWorkspace.get(workspaceId) || new Map();
    const existing = sessions.get(sessionId) || { sessionId, workspaceId };
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    sessions.set(sessionId, updated);
    this.sessionsByWorkspace.set(workspaceId, sessions);
    this.scheduleSave(workspaceId);
  }

  updateAgent(workspaceId, sessionId, agent, metadata = {}) {
    if (!agent) return;
    this.updateSession(workspaceId, sessionId, {
      lastAgent: agent,
      lastAgentAt: new Date().toISOString(),
      ...metadata
    });
  }

  updateServer(workspaceId, sessionId, command, metadata = {}) {
    if (!command) return;
    this.updateSession(workspaceId, sessionId, {
      lastServerCommand: command,
      lastServerAt: new Date().toISOString(),
      ...metadata
    });
  }
}

module.exports = { SessionRecoveryService };
