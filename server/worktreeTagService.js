const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/worktree-tags.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const DEFAULT_CONFIG_PATH = path.join(getAgentWorkspaceDir(), 'worktree-tags.json');

class WorktreeTagService {
  constructor({ configPath } = {}) {
    this.configPath = configPath || DEFAULT_CONFIG_PATH;
    this.tags = this.loadConfig();
  }

  static getInstance() {
    if (!WorktreeTagService.instance) {
      WorktreeTagService.instance = new WorktreeTagService();
    }
    return WorktreeTagService.instance;
  }

  loadConfig() {
    try {
      if (fsSync.existsSync(this.configPath)) {
        const raw = fsSync.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      }
    } catch (error) {
      logger.warn('Failed to load worktree tags config', { error: error.message });
    }

    return {};
  }

  async saveConfig() {
    try {
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(this.tags, null, 2));
    } catch (error) {
      logger.error('Failed to save worktree tags config', { error: error.message });
    }
  }

  getAll() {
    return this.tags || {};
  }

  async setReadyForReview(worktreePath, ready) {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    if (!this.tags) this.tags = {};
    const existing = this.tags[worktreePath] || {};

    this.tags[worktreePath] = {
      ...existing,
      readyForReview: !!ready,
      updatedAt: new Date().toISOString()
    };

    await this.saveConfig();
    return this.tags[worktreePath];
  }
}

module.exports = { WorktreeTagService };
