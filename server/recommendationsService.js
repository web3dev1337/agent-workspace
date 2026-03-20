const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/recommendations.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const CONFIG_PATH = path.join(getAgentWorkspaceDir(), 'recommendations.json');

class RecommendationsService {
  constructor() {
    this.configPath = CONFIG_PATH;
    this.items = this.loadItems();
  }

  static getInstance() {
    if (!RecommendationsService.instance) {
      RecommendationsService.instance = new RecommendationsService();
    }
    return RecommendationsService.instance;
  }

  loadItems() {
    try {
      if (fsSync.existsSync(this.configPath)) {
        const content = fsSync.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed.items) ? parsed.items : [];
      }
    } catch (error) {
      logger.warn('Failed to load recommendations', { error: error.message });
    }
    return [];
  }

  async save() {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify({ items: this.items }, null, 2));
    } catch (error) {
      logger.error('Failed to save recommendations', { error: error.message });
    }
  }

  getAll() {
    return this.items;
  }

  getPending() {
    return this.items.filter(i => i.status === 'pending');
  }

  async add({ package: pkg, reason, installCmd, category }) {
    if (!pkg || !installCmd) {
      throw new Error('package and installCmd are required');
    }

    const exists = this.items.find(i => i.package === pkg);
    if (exists) {
      if (exists.status === 'dismissed') {
        exists.status = 'pending';
        exists.reason = reason || exists.reason;
        await this.save();
        return exists;
      }
      return exists;
    }

    const item = {
      id: crypto.randomUUID(),
      package: pkg,
      reason: reason || '',
      installCmd,
      category: category || 'apt',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    this.items.push(item);
    await this.save();
    logger.info('Added recommendation', { package: pkg });
    return item;
  }

  async updateStatus(id, status) {
    const item = this.items.find(i => i.id === id);
    if (!item) throw new Error('Recommendation not found');
    item.status = status;
    item.updatedAt = new Date().toISOString();
    await this.save();
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex(i => i.id === id);
    if (index === -1) throw new Error('Recommendation not found');
    this.items.splice(index, 1);
    await this.save();
  }
}

module.exports = { RecommendationsService };
