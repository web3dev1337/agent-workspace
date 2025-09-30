const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { validateWorkspace, getWorkspaceTypeInfo, getDefaultWorkspaceConfig } = require('./workspaceTypes');
const { ConfigDiscoveryService } = require('./configDiscoveryService');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/workspace.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class WorkspaceManager {
  constructor() {
    this.workspaces = new Map();
    this.activeWorkspace = null;
    this.configPath = path.join(os.homedir(), '.orchestrator');
    this.workspacesPath = path.join(this.configPath, 'workspaces');
    this.templatesPath = path.join(this.configPath, 'templates');
    this.sessionStatesPath = path.join(this.configPath, 'session-states');

    // Dynamic config discovery
    this.discoveryService = new ConfigDiscoveryService();
    this.discoveredWorkspaceTypes = null;
    this.discoveryInProgress = false;
    this.discoveryComplete = false;
  }

  static getInstance() {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  async initialize() {
    logger.info('Initializing WorkspaceManager');

    try {
      // Ensure directory structure exists
      await this.ensureDirectories();

      // Load workspaces from disk
      await this.loadWorkspaces();

      // Discover dynamic workspace types from GitHub folder structure
      await this.discoverWorkspaceTypes();

      // Load or create master config
      await this.loadConfig();

      // Set active workspace (from config or first available)
      await this.initializeActiveWorkspace();

      logger.info(`WorkspaceManager initialized with ${this.workspaces.size} workspaces`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize WorkspaceManager', { error: error.message });
      throw error;
    }
  }

  async ensureDirectories() {
    const dirs = [
      this.configPath,
      this.workspacesPath,
      path.join(this.templatesPath, 'workspaces'),
      path.join(this.templatesPath, 'launch-settings'),
      this.sessionStatesPath
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          logger.error(`Failed to create directory ${dir}`, { error: error.message });
        }
      }
    }
  }

  /**
   * Get full cascaded config for a repository type
   * Merges: Global → Category → Framework → Specific Project
   * Examples:
   *   - Game: Global → games → hytopia → HyFire2
   *   - Book: Global → writing → book → PatternPlayers
   *   - Tool: Global → tools → cli → orchestrator
   * @param {string} repositoryType - e.g., "hyfire2-game", "patternplayers-book"
   * @returns {object} Fully merged config with all inherited properties
   */
  getCascadedConfig(repositoryType) {
    if (!this.discoveredWorkspaceTypes) {
      return null;
    }

    // Find the specific project config (game, book, script, plugin, tool, etc.)
    const specificConfig = this.discoveredWorkspaceTypes.games?.[repositoryType];
    if (!specificConfig) {
      return null;
    }

    // Start with empty base
    let mergedConfig = {};

    // Layer 1: Global config (if exists)
    // TODO: Load from ~/GitHub/.orchestrator-config.json when it exists
    const globalConfig = {};
    mergedConfig = this.mergeConfigs(mergedConfig, globalConfig);

    // Layer 2 & 3: Get framework first (to find category)
    const frameworkId = specificConfig.inherits;
    const frameworkConfig = frameworkId && this.discoveredWorkspaceTypes.frameworks?.[frameworkId];

    // Layer 2: Category config (derived from framework's category)
    // e.g., framework is "hytopia-framework" with category: "games"
    // or "book-framework" with category: "writing"
    if (frameworkConfig && frameworkConfig.category) {
      const categoryId = frameworkConfig.category;
      const categoryConfig = this.discoveredWorkspaceTypes.categories?.[categoryId];
      if (categoryConfig) {
        mergedConfig = this.mergeConfigs(mergedConfig, categoryConfig);
      }
    }

    // Layer 3: Framework config (e.g., "hytopia-framework", "monogame-framework", "book-framework")
    if (frameworkConfig) {
      mergedConfig = this.mergeConfigs(mergedConfig, frameworkConfig);
    }

    // Layer 4: Specific project config (game, book, script, plugin, tool, etc.)
    mergedConfig = this.mergeConfigs(mergedConfig, specificConfig);

    return mergedConfig;
  }

  /**
   * Deep merge two config objects with smart handling by key type
   *
   * Merge Strategies:
   * - gameModes/commonFlags: Shallow merge (child can override parent modes/flags)
   * - buttons/actions: Deep recursive merge (merge per terminal type, then per button)
   * - Other objects: Deep recursive merge
   * - Arrays: Override (child replaces parent)
   * - Primitives: Override (child replaces parent)
   *
   * Example button merge:
   *   Base:     { buttons: { server: { play: {...} } } }
   *   Override: { buttons: { server: { stop: {...} }, claude: { review: {...} } } }
   *   Result:   { buttons: { server: { play: {...}, stop: {...} }, claude: { review: {...} } } }
   *
   * @param {object} base - Base config object
   * @param {object} override - Override config object
   * @returns {object} Merged config with all properties from both configs
   */
  mergeConfigs(base, override) {
    const result = { ...base };

    for (const key in override) {
      if (!override.hasOwnProperty(key)) continue;

      if (override[key] === null || override[key] === undefined) {
        continue;
      }

      // Special handling for specific keys
      if (key === 'gameModes' || key === 'commonFlags') {
        // Merge modes/flags (override can add new ones or override existing)
        result[key] = { ...result[key], ...override[key] };
      } else if (key === 'buttons' || key === 'actions') {
        // Deep merge button/action objects (merge per terminal type, then per button)
        result[key] = this.mergeConfigs(result[key] || {}, override[key]);
      } else if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
        // Recursively merge objects
        result[key] = this.mergeConfigs(result[key] || {}, override[key]);
      } else {
        // Override primitives and arrays
        result[key] = override[key];
      }
    }

    return result;
  }

  /**
   * Enrich workspace terminals with missing repository.type from path
   * This handles old workspace configs that don't have repository.type set
   */
  async enrichWorkspaceRepositoryTypes(workspace) {
    // Only process workspaces with terminals (mixed-repo or array format)
    if (!workspace.terminals) {
      return;
    }

    const terminals = workspace.terminals.pairs || workspace.terminals;
    if (!Array.isArray(terminals)) {
      return;
    }

    for (const terminal of terminals) {
      // Skip if already has type
      if (terminal.repository?.type) {
        continue;
      }

      // Skip if no path to lookup
      if (!terminal.repository?.path) {
        continue;
      }

      // Check for .orchestrator-config.json in repository path
      const configPath = path.join(terminal.repository.path, '.orchestrator-config.json');
      try {
        if (fsSync.existsSync(configPath)) {
          // Use the discovered game ID format: {gamename}-game
          // This matches how ConfigDiscoveryService generates IDs
          const repoName = path.basename(terminal.repository.path)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-');
          terminal.repository.type = `${repoName}-game`;

          logger.info(`Auto-populated repository.type for terminal ${terminal.id}`, {
            path: terminal.repository.path,
            type: terminal.repository.type
          });
        } else {
          // Fallback: derive from path (e.g., /path/to/HyFire2 -> "hyfire2-game")
          const repoName = path.basename(terminal.repository.path)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-');
          terminal.repository.type = `${repoName}-game`;

          logger.info(`Derived repository.type from path for terminal ${terminal.id}`, {
            path: terminal.repository.path,
            type: terminal.repository.type
          });
        }
      } catch (error) {
        logger.warn(`Failed to enrich repository type for terminal ${terminal.id}`, {
          error: error.message
        });
      }
    }
  }

  async loadWorkspaces() {
    try {
      const files = await fs.readdir(this.workspacesPath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      logger.info(`Found ${jsonFiles.length} workspace config files`);

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.workspacesPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const workspace = JSON.parse(content);

          // Validate workspace
          const validation = validateWorkspace(workspace);
          if (!validation.valid) {
            logger.error(`Invalid workspace config: ${file}`, { errors: validation.errors });
            continue;
          }

          // Enrich workspace with missing repository types (for old configs)
          await this.enrichWorkspaceRepositoryTypes(workspace);

          // Add to workspaces map
          this.workspaces.set(workspace.id, workspace);
          logger.info(`Loaded workspace: ${workspace.name} (${workspace.id})`);
        } catch (error) {
          logger.error(`Failed to load workspace config: ${file}`, { error: error.message });
        }
      }

      return this.workspaces.size;
    } catch (error) {
      logger.error('Failed to read workspaces directory', { error: error.message });
      return 0;
    }
  }

  /**
   * Discover dynamic workspace types from GitHub folder structure
   */
  async discoverWorkspaceTypes() {
    logger.info('Discovering dynamic workspace types from GitHub hierarchy');
    this.discoveryInProgress = true;

    try {
      this.discoveredWorkspaceTypes = await this.discoveryService.discoverWorkspaceTypes();

      logger.info('Dynamic workspace discovery complete', {
        categories: Object.keys(this.discoveredWorkspaceTypes.categories || {}).length,
        frameworks: Object.keys(this.discoveredWorkspaceTypes.frameworks || {}).length,
        games: Object.keys(this.discoveredWorkspaceTypes.games || {}).length
      });

      this.discoveryComplete = true;

    } catch (error) {
      logger.warn('Dynamic workspace discovery failed, using fallbacks', { error: error.message });
      // Service will return fallback types on failure
      this.discoveryComplete = true; // Mark as complete even on failure (fallbacks loaded)
    } finally {
      this.discoveryInProgress = false;
    }
  }

  /**
   * Get workspace type info with dynamic discovery support
   */
  getWorkspaceTypeInfo(workspaceTypeId) {
    // First try discovered types
    if (this.discoveredWorkspaceTypes?.games?.[workspaceTypeId]) {
      return this.discoveredWorkspaceTypes.games[workspaceTypeId];
    }

    // Fallback to static types
    return getWorkspaceTypeInfo(workspaceTypeId);
  }

  /**
   * Get all available workspace types (static + discovered)
   */
  getAllWorkspaceTypes() {
    const staticTypes = require('./workspaceTypes').WORKSPACE_TYPES;
    const discoveredTypes = this.discoveredWorkspaceTypes?.games || {};

    return {
      ...staticTypes,
      ...discoveredTypes
    };
  }

  async loadConfig() {
    const configFile = path.join(this.configPath, 'config.json');

    try {
      const content = await fs.readFile(configFile, 'utf8');
      this.config = JSON.parse(content);
      logger.info('Loaded orchestrator config');
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Create default config
        this.config = this.getDefaultConfig();
        await this.saveConfig();
        logger.info('Created default orchestrator config');
      } else {
        logger.error('Failed to load config', { error: error.message });
        this.config = this.getDefaultConfig();
      }
    }
  }

  getDefaultConfig() {
    return {
      version: '2.0.0',
      activeWorkspace: null,
      workspaceDirectory: this.workspacesPath,
      discovery: {
        scanPaths: [
          path.join(os.homedir(), 'GitHub', 'games'),
          path.join(os.homedir(), 'GitHub', 'website'),
          path.join(os.homedir(), 'GitHub', 'tools')
        ],
        exclude: ['node_modules', '.git', 'dist', 'build', 'target']
      },
      globalShortcuts: [
        {
          label: 'GitHub Profile',
          url: 'https://github.com/web3dev1337',
          icon: '💻'
        },
        {
          label: 'Claude Code Docs',
          url: 'https://docs.claude.com',
          icon: '📚'
        }
      ],
      server: {
        port: process.env.PORT || 3000,
        host: '0.0.0.0'
      },
      ui: {
        theme: 'dark',
        startupDashboard: true,
        rememberLastWorkspace: true
      },
      orchestratorStartup: {
        autoUpdate: true,
        openBrowserOnStart: true,
        checkForNewRepos: false
      },
      user: {
        username: 'web3dev1337',
        teammates: [
          {
            username: 'Anrokx',
            access: 'team',
            repos: []
          }
        ]
      }
    };
  }

  async saveConfig() {
    const configFile = path.join(this.configPath, 'config.json');
    try {
      await fs.writeFile(configFile, JSON.stringify(this.config, null, 2));
      logger.info('Saved orchestrator config');
    } catch (error) {
      logger.error('Failed to save config', { error: error.message });
    }
  }

  async initializeActiveWorkspace() {
    // Priority:
    // 1. Config specifies active workspace
    // 2. Remember last workspace (from session)
    // 3. First available workspace
    // 4. None (show dashboard)

    // Don't auto-select workspace - let user choose from dashboard
    // if (this.config.activeWorkspace && this.workspaces.has(this.config.activeWorkspace)) {
    //   this.activeWorkspace = this.workspaces.get(this.config.activeWorkspace);
    //   logger.info(`Set active workspace from config: ${this.activeWorkspace.name}`);
    //   return;
    // }

    // Don't auto-select first workspace - show dashboard instead
    // if (this.workspaces.size > 0) {
    //   const firstWorkspace = Array.from(this.workspaces.values())[0];
    //   this.activeWorkspace = firstWorkspace;
    //   logger.info(`Set active workspace (first available): ${this.activeWorkspace.name}`);
    //   return;
    // }

    logger.info('No active workspace set (no workspaces available)');
  }

  async switchWorkspace(workspaceId) {
    logger.info(`Switching to workspace: ${workspaceId}`);

    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const newWorkspace = this.workspaces.get(workspaceId);

    // Save session states for current workspace (if any)
    if (this.activeWorkspace) {
      await this.saveSessionStates(this.activeWorkspace.id);
    }

    // Set new active workspace
    this.activeWorkspace = newWorkspace;

    // Update config
    this.config.activeWorkspace = workspaceId;
    await this.saveConfig();

    logger.info(`Switched to workspace: ${newWorkspace.name}`);

    return newWorkspace;
  }

  async saveSessionStates(workspaceId) {
    // Placeholder for saving session states
    // Will be implemented when integrating with SessionManager
    logger.debug(`Saving session states for workspace: ${workspaceId}`);
  }

  async restoreSessionStates(workspaceId) {
    // Placeholder for restoring session states
    // Will be implemented when integrating with SessionManager
    logger.debug(`Restoring session states for workspace: ${workspaceId}`);
  }

  getActiveWorkspace() {
    return this.activeWorkspace;
  }

  listWorkspaces(requestingUser = null) {
    let workspaces = Array.from(this.workspaces.values());

    // Filter by access level if requesting user is specified
    if (requestingUser && requestingUser !== this.config.user.username) {
      const teammate = this.config.user.teammates.find(t => t.username === requestingUser);
      if (!teammate) {
        logger.warn(`Unknown user requesting workspaces: ${requestingUser}`);
        return [];
      }

      workspaces = workspaces.filter(ws => {
        // Private workspaces are hidden from teammates
        if (ws.access === 'private') return false;

        // Team/public workspaces visible if user has repo access
        if (ws.access === 'team' || ws.access === 'public') {
          return teammate.repos.length === 0 || teammate.repos.includes(ws.id);
        }

        return false;
      });
    }

    return workspaces;
  }

  async createWorkspace(workspaceData) {
    logger.info(`Creating new workspace: ${workspaceData.name}`);

    // Validate
    const validation = validateWorkspace(workspaceData);
    if (!validation.valid) {
      throw new Error(`Invalid workspace config: ${validation.errors.join(', ')}`);
    }

    // Check if ID already exists
    if (this.workspaces.has(workspaceData.id)) {
      throw new Error(`Workspace ID already exists: ${workspaceData.id}`);
    }

    // Save to disk
    const filePath = path.join(this.workspacesPath, `${workspaceData.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(workspaceData, null, 2));

    // Add to memory
    this.workspaces.set(workspaceData.id, workspaceData);

    logger.info(`Created workspace: ${workspaceData.name} (${workspaceData.id})`);

    return workspaceData;
  }

  async updateWorkspace(workspaceId, updates) {
    logger.info(`Updating workspace: ${workspaceId}`);

    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const workspace = this.workspaces.get(workspaceId);
    const updated = { ...workspace, ...updates };

    // Validate
    const validation = validateWorkspace(updated);
    if (!validation.valid) {
      throw new Error(`Invalid workspace config: ${validation.errors.join(', ')}`);
    }

    // Save to disk
    const filePath = path.join(this.workspacesPath, `${workspaceId}.json`);
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2));

    // Update in memory
    this.workspaces.set(workspaceId, updated);

    // If this is the active workspace, update reference
    if (this.activeWorkspace && this.activeWorkspace.id === workspaceId) {
      this.activeWorkspace = updated;
    }

    logger.info(`Updated workspace: ${workspaceId}`);

    return updated;
  }

  async deleteWorkspace(workspaceId) {
    logger.info(`Deleting workspace: ${workspaceId}`);

    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    // Allow deleting active workspace (cleanup handled by caller)

    // Delete from disk
    const filePath = path.join(this.workspacesPath, `${workspaceId}.json`);
    await fs.unlink(filePath);

    // Remove from memory
    this.workspaces.delete(workspaceId);

    logger.info(`Deleted workspace: ${workspaceId}`);

    return true;
  }

  getWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId);
  }

  getConfig() {
    return this.config;
  }

  async updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    return this.config;
  }
}

module.exports = { WorkspaceManager };