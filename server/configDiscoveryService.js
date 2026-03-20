/**
 * Config Discovery Service - Dynamic workspace configuration discovery
 * Scans GitHub folder hierarchy and builds workspace types automatically
 */

const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class ConfigDiscoveryService {
  constructor() {
    const { getProjectsRoot } = require('./utils/pathUtils');
    this.basePath = getProjectsRoot();
    this.configCache = new Map();
    this.lastScanTime = null;
    this.frameworkTypes = new Map();
    this.gameTypes = new Map();
  }

  /**
   * Scan GitHub folder hierarchy and discover all workspace configurations
   */
  async discoverWorkspaceTypes() {
    logger.info('Starting dynamic workspace discovery', { basePath: this.basePath });

    try {
      // Clear previous discoveries
      this.frameworkTypes.clear();
      this.gameTypes.clear();

      // Scan root categories
      const categories = await this.scanCategories();

      // Scan frameworks within categories
      for (const category of categories) {
        await this.scanFrameworks(category);
      }

      // Scan specific games within frameworks
      for (const [frameworkId, framework] of this.frameworkTypes) {
        await this.scanGames(framework);
      }

      this.lastScanTime = new Date();

      logger.info('Discovery complete', {
        categories: categories.length,
        frameworks: this.frameworkTypes.size,
        games: this.gameTypes.size
      });

      return this.buildWorkspaceTypes();

    } catch (error) {
      logger.error('Discovery failed', { error: error.message, stack: error.stack });
      return this.getFallbackTypes();
    }
  }

  /**
   * Scan top-level categories (games, writing, tools, web, docs)
   */
  async scanCategories() {
    const categories = [];

    try {
      const entries = await fs.readdir(this.basePath);

      for (const entry of entries) {
        const categoryPath = path.join(this.basePath, entry);
        const stat = await fs.stat(categoryPath);

        if (stat.isDirectory() && !entry.startsWith('.')) {
          const categoryConfig = await this.loadCategoryConfig(categoryPath, entry);
          categories.push(categoryConfig);
        }
      }
    } catch (error) {
      logger.warn('Failed to scan categories', { error: error.message, stack: error.stack });
    }

    return categories;
  }

  /**
   * Load category configuration
   */
  async loadCategoryConfig(categoryPath, categoryName) {
    const { resolveRepoConfigPath } = require('./utils/pathUtils');
    const configPath = resolveRepoConfigPath(categoryPath);

    // Try to load custom config
    try {
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      config.path = categoryPath;
      config.discoveredName = categoryName;
      return config;
    } catch (error) {
      // Generate default config based on folder name
      return this.generateDefaultCategoryConfig(categoryPath, categoryName);
    }
  }

  /**
   * Generate default category config
   */
  generateDefaultCategoryConfig(categoryPath, categoryName) {
    const icons = {
      'games': '🎮',
      'board-games': '🎲',
      'writing': '📖',
      'tools': '🛠️',
      'web': '🌐',
      'docs': '📚',
      'website': '🌍'
    };

    return {
      id: `${categoryName}-category`,
      name: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
      type: 'category',
      icon: icons[categoryName] || '📁',
      path: categoryPath,
      discoveredName: categoryName
    };
  }

  /**
   * Scan frameworks within a category
   */
  async scanFrameworks(category) {
    // Scan frameworks for games and board-games categories
    if (category.discoveredName !== 'games' && category.discoveredName !== 'board-games') return;

    try {
      const entries = await fs.readdir(category.path);

      for (const entry of entries) {
        const frameworkPath = path.join(category.path, entry);
        const stat = await fs.stat(frameworkPath);

        if (stat.isDirectory()) {
          const frameworkConfig = await this.loadFrameworkConfig(frameworkPath, entry);
          if (frameworkConfig) {
            this.frameworkTypes.set(frameworkConfig.id, frameworkConfig);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to scan frameworks', { category: category.name, error: error.message, stack: error.stack });
    }
  }

  /**
   * Load framework configuration
   */
  async loadFrameworkConfig(frameworkPath, frameworkName) {
    const { resolveRepoConfigPath } = require('./utils/pathUtils');
    const configPath = resolveRepoConfigPath(frameworkPath);

    try {
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      config.path = frameworkPath;
      config.discoveredName = frameworkName;
      return config;
    } catch (error) {
      // Auto-detect framework type
      return await this.autoDetectFramework(frameworkPath, frameworkName);
    }
  }

  /**
   * Auto-detect framework type from folder structure and files
   */
  async autoDetectFramework(frameworkPath, frameworkName) {
    try {
      // Check for common framework indicators
      const entries = await fs.readdir(frameworkPath);

      // Board game detection - check if this is a direct board game project
      // Board games typically have a master/ or main/ subdirectory (worktree structure)
      const primaryDir = entries.includes('master') ? 'master' : entries.includes('main') ? 'main' : null;
      if (primaryDir) {
        const masterPath = path.join(frameworkPath, primaryDir);
        try {
          const masterStat = await fs.stat(masterPath);
          if (masterStat.isDirectory()) {
            // This looks like a board game with worktree structure
            return {
              id: `${frameworkName}-boardgame`,
              name: frameworkName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              type: 'framework',
              category: 'board-games',
              baseCommand: 'python main.py',
              commonFlags: ['MODE', 'EPISODES', 'RENDER'],
              icon: '🎲',
              path: frameworkPath,
              discoveredName: frameworkName,
              isBoardGame: true
            };
          }
        } catch (error) {
          // master/ exists but isn't a directory, continue to other detection
        }
      }

      // Hytopia framework detection
      if (frameworkName === 'hytopia') {
        return {
          id: 'hytopia-framework',
          name: 'Hytopia SDK',
          type: 'framework',
          category: 'games',
          baseCommand: 'hytopia start',
          commonFlags: ['NODE_ENV', 'AUTO_START_WITH_BOTS', 'DEBUG'],
          icon: '🎮',
          path: frameworkPath,
          discoveredName: frameworkName
        };
      }

      // MonoGame framework detection
      if (frameworkName === 'monogame') {
        return {
          id: 'monogame-framework',
          name: 'MonoGame Framework',
          type: 'framework',
          category: 'games',
          baseCommand: 'dotnet run',
          commonFlags: ['Configuration', 'Platform', 'Verbosity'],
          icon: '🕹️',
          path: frameworkPath,
          discoveredName: frameworkName
        };
      }

      // Web framework detection
      if (frameworkName === 'web') {
        return {
          id: 'web-framework',
          name: 'Web Framework',
          type: 'framework',
          category: 'games',
          baseCommand: 'npm start',
          commonFlags: ['NODE_ENV', 'PORT'],
          icon: '🌐',
          path: frameworkPath,
          discoveredName: frameworkName
        };
      }

      return null;
    } catch (error) {
      logger.warn('Framework auto-detection failed', { frameworkName, error: error.message, stack: error.stack });
      return null;
    }
  }

  /**
   * Scan specific games within a framework
   */
  async scanGames(framework) {
    try {
      // For board games, the framework path IS the game path
      // (each board game is its own self-contained project)
      if (framework.isBoardGame) {
        const gamePath = framework.path;
        const gameName = framework.discoveredName;
        const gameConfig = await this.loadGameConfig(gamePath, gameName, framework);
        if (gameConfig) {
          this.gameTypes.set(gameConfig.id, gameConfig);
        }
        return;
      }

      let gamesPath = framework.path;

      // For hytopia, games are in a subdirectory
      if (framework.discoveredName === 'hytopia') {
        gamesPath = path.join(framework.path, 'games');
      }

      const entries = await fs.readdir(gamesPath);

      for (const entry of entries) {
        const gamePath = path.join(gamesPath, entry);
        const stat = await fs.stat(gamePath);

        if (stat.isDirectory()) {
          const gameConfig = await this.loadGameConfig(gamePath, entry, framework);
          if (gameConfig) {
            this.gameTypes.set(gameConfig.id, gameConfig);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to scan games', { framework: framework.name, error: error.message, stack: error.stack });
    }
  }

  /**
   * Load game configuration
   */
  async loadGameConfig(gamePath, gameName, framework) {
    const { resolveRepoConfigPath } = require('./utils/pathUtils');
    // Try multiple locations for config file (prefers .agent-workspace-config.json, falls back to .orchestrator-config.json):
    // 1. gamePath (flat structure)
    // 2. gamePath/master (worktree structure)
    // 3. gamePath/main (worktree structure, main branch)
    const configPaths = [
      resolveRepoConfigPath(gamePath),
      resolveRepoConfigPath(path.join(gamePath, 'master')),
      resolveRepoConfigPath(path.join(gamePath, 'main'))
    ];

    let config = null;
    let configData = null;

    // Try each path until we find a config
    for (const configPath of configPaths) {
      try {
        configData = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(configData);
        logger.debug(`Found game config at ${configPath}`, { gameName });
        break;
      } catch (error) {
        // Config not found at this path, try next
        continue;
      }
    }

    if (config) {
      // Merge with auto-generated values
      const generatedConfig = {
        id: `${gameName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-game`,
        name: this.generateGameName(gameName),
        type: 'game',
        inherits: framework.id,
        path: gamePath,
        discoveredName: gameName
      };

      // Merge config file with generated values (config file overrides)
      return {
        ...generatedConfig,
        ...config
      };
    } else {
      // No config found, auto-generate game config
      return this.autoDetectGame(gamePath, gameName, framework);
    }
  }

  /**
   * Auto-detect game configuration
   */
  async autoDetectGame(gamePath, gameName, framework) {
    return {
      id: `${gameName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-game`,
      name: this.generateGameName(gameName),
      type: 'game',
      inherits: framework.id,
      icon: '🎮', // Default icon - can be overridden in config file
      path: gamePath,
      discoveredName: gameName,
      defaultTerminalPairs: 4,
      maxTerminalPairs: 8,
      // Try to detect game modes from package.json or source files
      gameModes: await this.detectGameModes(gamePath, gameName)
    };
  }

  /**
   * Generate friendly game name from folder name
   */
  generateGameName(folderName) {
    // Convert folder name to friendly name (no hardcoding)
    return folderName
      .replace(/([A-Z])/g, ' $1')  // Add spaces before capitals
      .replace(/-/g, ' ')          // Replace hyphens with spaces
      .replace(/_/g, ' ')          // Replace underscores with spaces
      .trim()
      .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
  }

  /**
   * Detect game modes from source files (fallback only - prefer config files)
   */
  async detectGameModes(gamePath, gameName) {
    const modes = {};

    try {
      // Check for MonoGame projects - add basic modes
      const csprojFiles = await fs.readdir(gamePath);
      const hasCsproj = csprojFiles.some(f => f.endsWith('.csproj'));

      if (hasCsproj) {
        modes.debug = { name: 'Debug', args: '--configuration Debug' };
        modes.release = { name: 'Release', args: '--configuration Release' };
      }

      // For Hytopia games without config, add basic mode
      const packageJson = await fs.readFile(path.join(gamePath, 'package.json'), 'utf8')
        .then(data => JSON.parse(data))
        .catch(() => null);

      if (packageJson?.dependencies?.hytopia || packageJson?.devDependencies?.hytopia) {
        modes.development = { name: 'Development', env: 'NODE_ENV=development' };
      }

    } catch (error) {
      logger.warn('Mode detection failed', { gameName, error: error.message, stack: error.stack });
    }

    return modes;
  }

  /**
   * Build final workspace types from discovered configs
   */
  buildWorkspaceTypes() {
    const workspaceTypes = {};

    // Add discovered games
    for (const [gameId, gameConfig] of this.gameTypes) {
      workspaceTypes[gameId] = {
        ...gameConfig,
        requiresServer: true,
        launchSettingsTemplate: gameConfig.id
      };
    }

    // Add fallback types
    const fallbackTypes = this.getFallbackTypes();
    Object.assign(workspaceTypes, fallbackTypes);

    return {
      categories: this.getCategoryHierarchy(),
      frameworks: Object.fromEntries(this.frameworkTypes),
      games: workspaceTypes
    };
  }

  /**
   * Get category hierarchy for UI display
   */
  getCategoryHierarchy() {
    const hierarchy = {};

    for (const [frameworkId, framework] of this.frameworkTypes) {
      const category = framework.category || 'other';

      if (!hierarchy[category]) {
        hierarchy[category] = {
          frameworks: [],
          games: []
        };
      }

      hierarchy[category].frameworks.push(framework);

      // Add games for this framework
      for (const [gameId, game] of this.gameTypes) {
        if (game.inherits === frameworkId) {
          hierarchy[category].games.push(game);
        }
      }
    }

    return hierarchy;
  }

  /**
   * Fallback workspace types (if discovery fails)
   */
  getFallbackTypes() {
    return {
      'hytopia-game': {
        id: 'hytopia-game',
        name: 'Hytopia Game',
        icon: '🎮',
        defaultTerminalPairs: 6
      },
      'monogame-game': {
        id: 'monogame-game',
        name: 'MonoGame Game',
        icon: '🕹️',
        defaultTerminalPairs: 4
      },
      'writing': {
        id: 'writing',
        name: 'Writing Project',
        icon: '📖',
        defaultTerminalPairs: 2
      }
    };
  }

  /**
   * Watch for config file changes and invalidate cache
   */
  startWatching() {
    // TODO: Implement file watching for .agent-workspace-config.json files
    // Invalidate cache when configs change
  }
}

module.exports = { ConfigDiscoveryService };