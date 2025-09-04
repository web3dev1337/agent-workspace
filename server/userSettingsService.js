const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/user-settings.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class UserSettingsService {
  constructor() {
    this.settingsPath = path.join(__dirname, '..', 'user-settings.json');
    this.settings = this.loadSettings();
  }

  static getInstance() {
    if (!UserSettingsService.instance) {
      UserSettingsService.instance = new UserSettingsService();
    }
    return UserSettingsService.instance;
  }

  getDefaultSettings() {
    return {
      version: '1.0.0',
      global: {
        claudeFlags: {
          skipPermissions: false,
          // Add other global Claude flags here in the future
        },
        terminal: {
          // Add other global terminal settings here in the future
        }
      },
      perTerminal: {
        // sessionId -> override settings
        // Example:
        // "work1-claude": { claudeFlags: { skipPermissions: true } }
      }
    };
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const settings = JSON.parse(data);
        
        // Merge with defaults to ensure all properties exist
        const defaults = this.getDefaultSettings();
        const merged = this.mergeSettings(defaults, settings);
        
        logger.info('Loaded user settings', { path: this.settingsPath });
        return merged;
      } else {
        logger.info('No user settings file found, creating with defaults', { 
          path: this.settingsPath 
        });
        const defaults = this.getDefaultSettings();
        this.saveSettings(defaults);
        return defaults;
      }
    } catch (error) {
      logger.error('Failed to load user settings, using defaults', { 
        path: this.settingsPath,
        error: error.message 
      });
      return this.getDefaultSettings();
    }
  }

  mergeSettings(defaults, userSettings) {
    const merged = JSON.parse(JSON.stringify(defaults)); // Deep clone defaults
    
    if (userSettings.global) {
      if (userSettings.global.claudeFlags) {
        Object.assign(merged.global.claudeFlags, userSettings.global.claudeFlags);
      }
      if (userSettings.global.terminal) {
        Object.assign(merged.global.terminal, userSettings.global.terminal);
      }
    }
    
    if (userSettings.perTerminal) {
      merged.perTerminal = { ...merged.perTerminal, ...userSettings.perTerminal };
    }
    
    return merged;
  }

  saveSettings(settings = null) {
    try {
      const toSave = settings || this.settings;
      fs.writeFileSync(this.settingsPath, JSON.stringify(toSave, null, 2));
      logger.info('Saved user settings', { path: this.settingsPath });
      return true;
    } catch (error) {
      logger.error('Failed to save user settings', { 
        path: this.settingsPath,
        error: error.message 
      });
      return false;
    }
  }

  // Get effective settings for a specific session
  getEffectiveSettings(sessionId) {
    const global = this.settings.global;
    const perTerminal = this.settings.perTerminal[sessionId] || {};
    
    // Merge global and per-terminal settings
    const effective = {
      claudeFlags: {
        ...global.claudeFlags,
        ...(perTerminal.claudeFlags || {})
      },
      terminal: {
        ...global.terminal,
        ...(perTerminal.terminal || {})
      }
    };
    
    return effective;
  }

  // Update global settings
  updateGlobalSettings(newGlobal) {
    try {
      // Simply update the global settings directly
      this.settings.global = {
        ...this.getDefaultSettings().global,
        ...newGlobal
      };
      
      // Deep merge claudeFlags and terminal
      if (newGlobal.claudeFlags) {
        this.settings.global.claudeFlags = {
          ...this.getDefaultSettings().global.claudeFlags,
          ...newGlobal.claudeFlags
        };
      }
      
      if (newGlobal.terminal) {
        this.settings.global.terminal = {
          ...this.getDefaultSettings().global.terminal,
          ...newGlobal.terminal
        };
      }
      
      const saved = this.saveSettings();
      if (saved) {
        logger.info('Updated global settings', { settings: this.settings.global });
      }
      
      return saved;
    } catch (error) {
      logger.error('Failed to update global settings', { error: error.message });
      return false;
    }
  }

  // Update per-terminal settings
  updatePerTerminalSettings(sessionId, settings) {
    try {
      if (!this.settings.perTerminal) {
        this.settings.perTerminal = {};
      }
      
      this.settings.perTerminal[sessionId] = {
        ...this.settings.perTerminal[sessionId],
        ...settings
      };
      
      const saved = this.saveSettings();
      if (saved) {
        logger.info('Updated per-terminal settings', { 
          sessionId, 
          settings: this.settings.perTerminal[sessionId] 
        });
      }
      
      return saved;
    } catch (error) {
      logger.error('Failed to update per-terminal settings', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }

  // Remove per-terminal settings
  clearPerTerminalSettings(sessionId) {
    try {
      if (this.settings.perTerminal && this.settings.perTerminal[sessionId]) {
        delete this.settings.perTerminal[sessionId];
        const saved = this.saveSettings();
        if (saved) {
          logger.info('Cleared per-terminal settings', { sessionId });
        }
        return saved;
      }
      return true;
    } catch (error) {
      logger.error('Failed to clear per-terminal settings', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }

  // Get all settings (for API)
  getAllSettings() {
    return JSON.parse(JSON.stringify(this.settings)); // Return deep copy
  }
}

module.exports = { UserSettingsService };