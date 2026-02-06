const fs = require('fs');
const os = require('os');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/sessions.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const MAX_GLOBAL_HISTORY = 5000;
const MAX_SESSION_HISTORY = 1000;
const MIN_PREFIX_LENGTH = 2;

class CommandHistoryService {
  constructor() {
    this.sessionHistories = new Map();
    this.globalHistory = [];
    this.loadShellHistory();
  }

  loadShellHistory() {
    const histPaths = [
      path.join(os.homedir(), '.bash_history'),
      path.join(os.homedir(), '.zsh_history')
    ];

    const seen = new Set();

    for (const histPath of histPaths) {
      try {
        if (!fs.existsSync(histPath)) continue;
        const content = fs.readFileSync(histPath, 'utf8');
        const lines = content.split('\n');

        for (const raw of lines) {
          // zsh_history lines may have `: timestamp:0;command` format
          let line = raw;
          const zshMatch = raw.match(/^: \d+:\d+;(.+)$/);
          if (zshMatch) line = zshMatch[1];

          const trimmed = line.trim();
          if (!trimmed || seen.has(trimmed)) continue;

          seen.add(trimmed);
          this.globalHistory.push(trimmed);
        }
      } catch (err) {
        logger.debug('Could not read shell history', { path: histPath, error: err.message });
      }
    }

    // Keep only the most recent entries
    if (this.globalHistory.length > MAX_GLOBAL_HISTORY) {
      this.globalHistory = this.globalHistory.slice(-MAX_GLOBAL_HISTORY);
    }

    logger.info('Shell history loaded for autosuggestions', { entries: this.globalHistory.length });
  }

  addCommand(sessionId, command) {
    const trimmed = command.trim();
    if (!trimmed || trimmed.length < MIN_PREFIX_LENGTH) return;

    // Add to session history
    if (!this.sessionHistories.has(sessionId)) {
      this.sessionHistories.set(sessionId, []);
    }
    const sessionHistory = this.sessionHistories.get(sessionId);
    if (sessionHistory[sessionHistory.length - 1] !== trimmed) {
      sessionHistory.push(trimmed);
      if (sessionHistory.length > MAX_SESSION_HISTORY) {
        sessionHistory.splice(0, sessionHistory.length - MAX_SESSION_HISTORY);
      }
    }

    // Add to global history
    if (this.globalHistory[this.globalHistory.length - 1] !== trimmed) {
      this.globalHistory.push(trimmed);
      if (this.globalHistory.length > MAX_GLOBAL_HISTORY) {
        this.globalHistory.splice(0, this.globalHistory.length - MAX_GLOBAL_HISTORY);
      }
    }
  }

  findMatch(sessionId, prefix) {
    if (!prefix || prefix.length < MIN_PREFIX_LENGTH) return null;

    // Search session history first (most recent first)
    const sessionHistory = this.sessionHistories.get(sessionId) || [];
    for (let i = sessionHistory.length - 1; i >= 0; i--) {
      if (sessionHistory[i].startsWith(prefix) && sessionHistory[i] !== prefix) {
        return sessionHistory[i];
      }
    }

    // Then search global history (most recent first)
    for (let i = this.globalHistory.length - 1; i >= 0; i--) {
      if (this.globalHistory[i].startsWith(prefix) && this.globalHistory[i] !== prefix) {
        return this.globalHistory[i];
      }
    }

    return null;
  }

  clearSession(sessionId) {
    this.sessionHistories.delete(sessionId);
  }
}

// Singleton
let instance = null;
function getInstance() {
  if (!instance) {
    instance = new CommandHistoryService();
  }
  return instance;
}

module.exports = { CommandHistoryService, getInstance };
