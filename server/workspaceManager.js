const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { validateWorkspace, getWorkspaceTypeInfo, getDefaultWorkspaceConfig } = require('./workspaceTypes');

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