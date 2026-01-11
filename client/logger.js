/**
 * Client-side logger with level filtering
 * Reduces console spam in production while keeping debug info available
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

// Default to 'info' - can be changed via window.LOG_LEVEL or localStorage
const getLogLevel = () => {
  if (typeof window !== 'undefined') {
    // Check localStorage first (persists across sessions)
    const stored = localStorage.getItem('LOG_LEVEL');
    if (stored && LOG_LEVELS[stored] !== undefined) {
      return LOG_LEVELS[stored];
    }
    // Check window global (set at runtime)
    if (window.LOG_LEVEL && LOG_LEVELS[window.LOG_LEVEL] !== undefined) {
      return LOG_LEVELS[window.LOG_LEVEL];
    }
  }
  // Default: only show info, warn, error (hide debug and trace)
  return LOG_LEVELS.info;
};

class ClientLogger {
  constructor(prefix = '') {
    this.prefix = prefix;
  }

  _log(level, levelName, ...args) {
    if (level <= getLogLevel()) {
      const timestamp = new Date().toISOString().substr(11, 12);
      const prefix = this.prefix ? `[${this.prefix}]` : '';
      console[levelName === 'trace' ? 'debug' : levelName](
        `${timestamp} ${prefix}`,
        ...args
      );
    }
  }

  error(...args) {
    this._log(LOG_LEVELS.error, 'error', ...args);
  }

  warn(...args) {
    this._log(LOG_LEVELS.warn, 'warn', ...args);
  }

  info(...args) {
    this._log(LOG_LEVELS.info, 'info', ...args);
  }

  debug(...args) {
    this._log(LOG_LEVELS.debug, 'debug', ...args);
  }

  trace(...args) {
    this._log(LOG_LEVELS.trace, 'trace', ...args);
  }

  // Create a child logger with a prefix
  child(prefix) {
    return new ClientLogger(this.prefix ? `${this.prefix}:${prefix}` : prefix);
  }
}

// Export singleton and helper to set log level
const logger = new ClientLogger();

// Helper to change log level at runtime
window.setLogLevel = (level) => {
  if (LOG_LEVELS[level] !== undefined) {
    localStorage.setItem('LOG_LEVEL', level);
    console.log(`Log level set to: ${level}`);
  } else {
    console.log(`Invalid level. Use: error, warn, info, debug, trace`);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { logger, ClientLogger };
}
