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
    new winston.transports.File({ filename: 'logs/quick-links.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const CONFIG_PATH = path.join(getAgentWorkspaceDir(), 'quick-links.json');

class QuickLinksService {
  constructor() {
    this.configPath = CONFIG_PATH;
    this.config = this.loadConfig();
  }

  static getInstance() {
    if (!QuickLinksService.instance) {
      QuickLinksService.instance = new QuickLinksService();
    }
    return QuickLinksService.instance;
  }

  loadConfig() {
    try {
      if (fsSync.existsSync(this.configPath)) {
        const content = fsSync.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(content);
        return {
          favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
          recentSessions: Array.isArray(parsed.recentSessions) ? parsed.recentSessions : [],
          customLinks: Array.isArray(parsed.customLinks) ? parsed.customLinks : [],
          products: Array.isArray(parsed.products) ? parsed.products : []
        };
      }
    } catch (error) {
      logger.warn('Failed to load quick-links config', { error: error.message });
    }

    // Default config
    return {
      favorites: [
        { name: 'GitHub', url: 'https://github.com', icon: 'github' },
        { name: 'Claude Docs', url: 'https://docs.anthropic.com', icon: 'docs' }
      ],
      recentSessions: [],
      customLinks: [],
      products: []
    };
  }

  async saveConfig() {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      logger.debug('Saved quick-links config');
    } catch (error) {
      logger.error('Failed to save quick-links config', { error: error.message });
    }
  }

  /**
   * Get all quick links data
   */
  async getAll() {
    return {
      favorites: this.config.favorites,
      recentSessions: this.config.recentSessions.slice(0, 10), // Last 10
      customLinks: this.config.customLinks,
      products: this.config.products
    };
  }

  /**
   * Add a favorite link
   */
  async addFavorite(favorite) {
    const { name, url, icon } = favorite;

    if (!name || !url) {
      throw new Error('Name and URL are required');
    }

    // Check for duplicates
    const exists = this.config.favorites.some(f => f.url === url);
    if (exists) {
      throw new Error('Link already exists in favorites');
    }

    this.config.favorites.push({
      name,
      url,
      icon: icon || 'link',
      addedAt: new Date().toISOString()
    });

    await this.saveConfig();
    return this.config.favorites;
  }

  /**
   * Remove a favorite link
   */
  async removeFavorite(url) {
    const index = this.config.favorites.findIndex(f => f.url === url);
    if (index === -1) {
      throw new Error('Favorite not found');
    }

    this.config.favorites.splice(index, 1);
    await this.saveConfig();
    return this.config.favorites;
  }

  /**
   * Reorder favorites
   */
  async reorderFavorites(urls) {
    const newOrder = [];
    for (const url of urls) {
      const fav = this.config.favorites.find(f => f.url === url);
      if (fav) newOrder.push(fav);
    }

    // Add any that weren't in the order
    for (const fav of this.config.favorites) {
      if (!newOrder.includes(fav)) {
        newOrder.push(fav);
      }
    }

    this.config.favorites = newOrder;
    await this.saveConfig();
    return this.config.favorites;
  }

  /**
   * Track a recent session
   */
  async trackSession(sessionInfo) {
    const { workspaceId, worktreeId, sessionId, branch, goal } = sessionInfo;

    // Remove existing entry for same session
    this.config.recentSessions = this.config.recentSessions.filter(
      s => !(s.workspaceId === workspaceId && s.worktreeId === worktreeId)
    );

    // Add new entry at the beginning
    this.config.recentSessions.unshift({
      workspaceId,
      worktreeId,
      sessionId,
      branch,
      goal,
      lastAccess: new Date().toISOString()
    });

    // Keep only last 20
    this.config.recentSessions = this.config.recentSessions.slice(0, 20);

    await this.saveConfig();
    return this.config.recentSessions;
  }

  /**
   * Clear recent sessions
   */
  async clearRecentSessions() {
    this.config.recentSessions = [];
    await this.saveConfig();
    return [];
  }

  /**
   * Get recent sessions with optional filtering
   */
  getRecentSessions(options = {}) {
    let sessions = [...this.config.recentSessions];

    if (options.workspaceId) {
      sessions = sessions.filter(s => s.workspaceId === options.workspaceId);
    }

    if (options.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    return sessions;
  }

  /**
   * Add a custom link (project-specific)
   */
  async addCustomLink(link) {
    const { name, url, category, workspaceId } = link;

    if (!name || !url) {
      throw new Error('Name and URL are required');
    }

    this.config.customLinks.push({
      name,
      url,
      category: category || 'General',
      workspaceId: workspaceId || null,
      addedAt: new Date().toISOString()
    });

    await this.saveConfig();
    return this.config.customLinks;
  }

  /**
   * Remove a custom link
   */
  async removeCustomLink(url) {
    const index = this.config.customLinks.findIndex(l => l.url === url);
    if (index === -1) {
      throw new Error('Link not found');
    }

    this.config.customLinks.splice(index, 1);
    await this.saveConfig();
    return this.config.customLinks;
  }

  /**
   * Add a product (launchable service)
   */
  async addProduct(product) {
    const { name, masterPath, startCommand, url, icon } = product;

    if (!name || !masterPath || !startCommand || !url) {
      throw new Error('name, masterPath, startCommand, and url are required');
    }

    // Check for duplicates by masterPath
    const exists = this.config.products.some(p => p.masterPath === masterPath);
    if (exists) {
      throw new Error('Product already exists for this masterPath');
    }

    this.config.products.push({
      id: crypto.randomUUID(),
      name,
      masterPath,
      startCommand,
      url,
      icon: icon || 'rocket',
      addedAt: new Date().toISOString()
    });

    await this.saveConfig();
    return this.config.products;
  }

  /**
   * Remove a product by id
   */
  async removeProduct(id) {
    const index = this.config.products.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error('Product not found');
    }

    this.config.products.splice(index, 1);
    await this.saveConfig();
    return this.config.products;
  }

  getProductById(id) {
    return this.config.products.find(p => p.id === id) || null;
  }

  /**
   * Get custom links for a workspace
   */
  getCustomLinks(workspaceId = null) {
    if (workspaceId) {
      return this.config.customLinks.filter(
        l => l.workspaceId === workspaceId || l.workspaceId === null
      );
    }
    return this.config.customLinks;
  }

  /**
   * Get default link icons
   */
  getAvailableIcons() {
    return [
      'github', 'gitlab', 'bitbucket',
      'trello', 'jira', 'notion', 'figma',
      'docs', 'api', 'dashboard',
      'slack', 'discord', 'teams',
      'link', 'folder', 'code', 'terminal'
    ];
  }
}

module.exports = { QuickLinksService };
