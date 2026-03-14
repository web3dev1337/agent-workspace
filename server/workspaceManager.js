const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { validateWorkspace, getWorkspaceTypeInfo, getDefaultWorkspaceConfig } = require('./workspaceTypes');
const { ConfigDiscoveryService } = require('./configDiscoveryService');
const { GitHubRepoService } = require('./githubRepoService');
const { createProject } = require('../scripts/create-project');

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
    this.workspaceHealth = new Map();
    this.configPath = path.join(os.homedir(), '.orchestrator');
    this.workspacesPath = path.join(this.configPath, 'workspaces');
    this.deletedWorkspacesPath = path.join(this.configPath, 'deleted-workspaces');
    this.templatesPath = path.join(this.configPath, 'templates');
    this.sessionStatesPath = path.join(this.configPath, 'session-states');

    // Dynamic config discovery
    this.discoveryService = new ConfigDiscoveryService();
    this.discoveredWorkspaceTypes = null;
    this.discoveryInProgress = false;
    this.discoveryComplete = false;

    // GitHub metadata enrichment (repo visibility/access)
    this.githubRepoService = GitHubRepoService.getInstance();
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
      logger.error('Failed to initialize WorkspaceManager', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async ensureDirectories() {
    const dirs = [
      this.configPath,
      this.workspacesPath,
      this.deletedWorkspacesPath,
      path.join(this.templatesPath, 'workspaces'),
      path.join(this.templatesPath, 'launch-settings'),
      this.sessionStatesPath
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          logger.error(`Failed to create directory ${dir}`, { error: error.message, stack: error.stack });
        }
      }
    }
  }

  /**
   * Get cascaded config for a specific worktree path
   * This loads the config from the actual worktree directory (work1, work2, master, etc.)
   * Merges: Global → Category → Framework → Project → Worktree-specific config
   * @param {string} repositoryType - e.g., "hyfire2-game"
	   * @param {string} worktreePath - Full path to worktree, e.g., "$HOME/GitHub/games/hytopia/games/HyFire2/work1"
   * @returns {object} Fully merged config with worktree-specific overrides
   */
  async getCascadedConfigForWorktree(repositoryType, worktreePath) {
    // Get base cascaded config (Global → Category → Framework → Project)
    const baseConfig = this.getCascadedConfig(repositoryType);
    if (!baseConfig) return null;

    // Deep clone to avoid mutating cached configs
    const baseConfigCopy = JSON.parse(JSON.stringify(baseConfig));

    // Load worktree-specific config
    const worktreeConfigPath = path.join(worktreePath, '.orchestrator-config.json');
    try {
      const configData = await fs.readFile(worktreeConfigPath, 'utf8');
      const worktreeConfig = JSON.parse(configData);

      // Merge worktree config on top of base copy
      return this.mergeConfigs(baseConfigCopy, worktreeConfig);
    } catch (error) {
      // No worktree-specific config, return base copy
      return baseConfigCopy;
    }
  }

  /**
   * Get full cascaded config for a repository type (legacy method)
   * Merges: Global → Category → Framework → Specific Project
   * NOTE: This uses the project config from discovery, not worktree-specific
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
    // CRITICAL: Deep clone base to prevent cache mutation
    // Shallow spread ({ ...base }) shares nested object references,
    // causing cached configs to be modified when we merge
    const result = JSON.parse(JSON.stringify(base || {}));

    if (!override) return result;

    for (const key in override) {
      if (!override.hasOwnProperty(key)) continue;

      if (override[key] === null || override[key] === undefined) {
        continue;
      }

      // Special handling for specific keys
      if (key === 'gameModes' || key === 'commonFlags') {
        // Merge modes/flags (override can add new ones or override existing)
        // Deep clone override[key] too to prevent mutation
        const overrideValue = JSON.parse(JSON.stringify(override[key]));
        result[key] = { ...(result[key] || {}), ...overrideValue };
      } else if (key === 'buttons' || key === 'actions') {
        // Deep merge button/action objects (merge per terminal type, then per button)
        result[key] = this.mergeConfigs(result[key] || {}, override[key]);
      } else if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
        // Recursively merge objects
        result[key] = this.mergeConfigs(result[key] || {}, override[key]);
      } else {
        // Override primitives and arrays (deep clone arrays too)
        result[key] = Array.isArray(override[key])
          ? JSON.parse(JSON.stringify(override[key]))
          : override[key];
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
          const stats = await fs.stat(filePath).catch(() => null);
          const content = await fs.readFile(filePath, 'utf8');
          const workspace = JSON.parse(content);
          const normalize = this.normalizeWorkspacePaths(workspace);
          const normalizedWorkspace = normalize.workspace;

          const sanitize = this.sanitizeWorkspaceTerminals(normalizedWorkspace);
          const sanitizedWorkspace = sanitize.workspace;

          const migrationChanges = []
            .concat(normalize.changed ? [{ kind: 'normalize', changes: normalize.changes }] : [])
            .concat(sanitize.changed ? [{ kind: 'sanitize', changes: sanitize.changes }] : []);

          if (migrationChanges.length) {
            try {
              await fs.writeFile(filePath, JSON.stringify(sanitizedWorkspace, null, 2));
              logger.info('Auto-migrated workspace config', {
                workspaceId: sanitizedWorkspace.id,
                file,
                normalizeChanged: normalize.changed,
                sanitizeChanged: sanitize.changed,
                normalizeChanges: normalize.changes,
                sanitizeChanges: sanitize.changes
              });
            } catch (error) {
              logger.warn('Failed to persist auto-migration (continuing with in-memory config)', {
                workspaceId: sanitizedWorkspace.id,
                file,
                error: error.message
              });
            }
          }

          // Backfill lastAccess for older configs so the dashboard has something meaningful to show.
          // We use the config file mtime as a reasonable approximation until the user opens a workspace.
          if (!sanitizedWorkspace.lastAccess && stats?.mtime) {
            sanitizedWorkspace.lastAccess = new Date(stats.mtime).toISOString();
          }

          // Validate workspace
          const validation = validateWorkspace(sanitizedWorkspace);
          if (!validation.valid) {
            logger.error(`Invalid workspace config: ${file}`, { errors: validation.errors });
            continue;
          }

          // Enrich workspace with missing repository types (for old configs)
          await this.enrichWorkspaceRepositoryTypes(sanitizedWorkspace);

          // Add to workspaces map
          this.workspaces.set(sanitizedWorkspace.id, sanitizedWorkspace);
          if (sanitize.health) {
            this.workspaceHealth.set(sanitizedWorkspace.id, sanitize.health);
          }
          logger.info(`Loaded workspace: ${sanitizedWorkspace.name} (${sanitizedWorkspace.id})`);
        } catch (error) {
          logger.error(`Failed to load workspace config: ${file}`, { error: error.message, stack: error.stack });
        }
      }

      return this.workspaces.size;
    } catch (error) {
      logger.error('Failed to read workspaces directory', { error: error.message, stack: error.stack });
      return 0;
    }
  }

  sanitizeWorkspaceTerminals(ws) {
    const changes = [];
    const health = {
      cleanedAt: new Date().toISOString(),
      removedTerminals: [],
      dedupedTerminalIds: [],
      fixedWorktreePaths: [],
      staleCandidates: []
    };

    const next = JSON.parse(JSON.stringify(ws || {}));
    if (!Array.isArray(next.terminals)) {
      return { workspace: next, changed: false, changes: [], health: null };
    }

    const seenIds = new Set();
    const deduped = [];

    const shouldKeepMissingWorktree = (terminal) => {
      const wt = String(terminal?.worktree || '').trim();
      if (/^work\\d+$/i.test(wt)) return true;
      const wtPath = String(terminal?.worktreePath || '').trim();
      if (/\\bwork\\d+\\b/i.test(path.basename(wtPath))) return true;
      return false;
    };

    for (const terminal of next.terminals) {
      if (!terminal || typeof terminal !== 'object') continue;

      const id = String(terminal.id || '').trim();
      if (!id) continue;

      if (seenIds.has(id)) {
        health.dedupedTerminalIds.push(id);
        changes.push({ field: 'terminals[]', terminalId: id, reason: 'duplicate_id_removed' });
        continue;
      }
      seenIds.add(id);

      const repoPath = String(terminal?.repository?.path || '').trim();
      const repoName = String(terminal?.repository?.name || '').trim();
      const worktree = String(terminal?.worktree || '').trim();
      const explicitWorktreePath = String(terminal?.worktreePath || '').trim();
      const derived = (repoPath && worktree) ? path.join(repoPath, worktree) : '';

      // If repo path itself is missing, it's almost certainly stale (e.g. old /home/test references).
      if (repoPath && !fsSync.existsSync(repoPath)) {
        health.removedTerminals.push({ id, repoName, repoPath, worktree, worktreePath: explicitWorktreePath || derived, reason: 'repo_path_missing' });
        changes.push({ field: 'terminals[]', terminalId: id, reason: 'repo_path_missing_removed', repoPath });
        continue;
      }

      // Fix common “repo root terminal” mis-shape: repoPath=/home/user/GitHub, worktree=GitHub → joined /home/user/GitHub/GitHub (missing)
      if (!explicitWorktreePath && repoPath && worktree) {
        const joined = derived;
        if (!fsSync.existsSync(joined) && fsSync.existsSync(repoPath) && path.basename(repoPath) === worktree) {
          terminal.worktreePath = repoPath;
          health.fixedWorktreePaths.push({ id, from: joined, to: repoPath, reason: 'worktree_equals_repo_basename_use_repo_root' });
          changes.push({ field: 'terminals[].worktreePath', terminalId: id, from: joined, to: repoPath, reason: 'worktree_equals_repo_basename_use_repo_root' });
        }
      }

      const wtPath = String(terminal.worktreePath || '').trim() || derived;
      if (wtPath) {
        const exists = fsSync.existsSync(wtPath);
        if (!exists && !shouldKeepMissingWorktree(terminal)) {
          // Keep it as a candidate (UI can remove); also auto-remove to stop log spam.
          health.removedTerminals.push({ id, repoName, repoPath, worktree, worktreePath: wtPath, reason: 'worktree_path_missing' });
          changes.push({ field: 'terminals[]', terminalId: id, reason: 'worktree_path_missing_removed', worktreePath: wtPath });
          continue;
        }
        if (!exists && shouldKeepMissingWorktree(terminal)) {
          health.staleCandidates.push({ id, repoName, repoPath, worktree, worktreePath: wtPath, reason: 'worktree_missing_but_looks_createable' });
        }
      }

      deduped.push(terminal);
    }

    if (deduped.length !== next.terminals.length) {
      next.terminals = deduped;
    }

    const changed = changes.length > 0;
    const hasHealth = health.removedTerminals.length || health.dedupedTerminalIds.length || health.fixedWorktreePaths.length || health.staleCandidates.length;
    return { workspace: next, changed, changes, health: hasHealth ? health : null };
  }

  /**
   * Normalize workspace repo/worktree paths for older/misconfigured mixed-repo workspaces.
   *
   * Current heuristic: if a stored path doesn't exist, and it contains `/games/hytopia/games/`,
   * try a best-effort migration to `/games/hytopia/` (removes the extra `games/` segment).
   *
   * This fixes common "Worktree Inspector does nothing" cases where worktreePath points at a non-existent directory.
   */
  normalizeWorkspacePaths(workspace) {
    const ws = workspace && typeof workspace === 'object' ? workspace : {};
    const changes = [];

    const removeExtraHytopiaGamesSegment = (inputPath) => {
      const raw = String(inputPath || '').trim();
      if (!raw) return null;
      // Handles both POSIX and Windows separators.
      const pattern = /([\\/])games\1hytopia\1games\1/;
      if (!pattern.test(raw)) return null;
      return raw.replace(pattern, '$1games$1hytopia$1');
    };

    const tryFixPath = (p) => {
      const raw = String(p || '').trim();
      if (!raw) return { value: raw, changed: false, from: raw, to: raw, reason: null };
      if (fsSync.existsSync(raw)) {
        return { value: raw, changed: false, from: raw, to: raw, reason: null };
      }

      const variants = [];
      const candidate = removeExtraHytopiaGamesSegment(raw);
      if (candidate) {
        variants.push({ candidate, reason: 'remove_extra_hytopia_games_segment' });
      }

      for (const v of variants) {
        if (!v?.candidate) continue;
        if (v.candidate === raw) continue;
        if (fsSync.existsSync(v.candidate)) {
          return { value: v.candidate, changed: true, from: raw, to: v.candidate, reason: v.reason };
        }
      }

      return { value: raw, changed: false, from: raw, to: raw, reason: null };
    };

    const next = JSON.parse(JSON.stringify(ws || {}));

    if (next.repository && typeof next.repository === 'object') {
      const fixed = tryFixPath(next.repository.path);
      if (fixed.changed) {
        next.repository.path = fixed.value;
        changes.push({ field: 'repository.path', from: fixed.from, to: fixed.to, reason: fixed.reason });
      }
    }

    if (Array.isArray(next.terminals)) {
      for (const terminal of next.terminals) {
        if (!terminal || typeof terminal !== 'object') continue;
        if (terminal.repository && typeof terminal.repository === 'object') {
          const beforeRepo = String(terminal.repository.path || '').trim();
          const fixedRepo = tryFixPath(terminal.repository.path);
          if (fixedRepo.changed) {
            terminal.repository.path = fixedRepo.value;
            changes.push({ field: `terminals[].repository.path`, terminalId: terminal.id, from: fixedRepo.from, to: fixedRepo.to, reason: fixedRepo.reason });
          }

          // If we migrated the repo root, keep worktreePath consistent even if the worktree folder
          // doesn't exist yet (auto-create will create it later). This avoids storing a permanently
          // broken worktreePath that prevents session startup/inspector.
          const afterRepo = String(terminal.repository.path || '').trim();
          const wtRaw = String(terminal.worktreePath || '').trim();
          if (beforeRepo && afterRepo && wtRaw && fixedRepo.changed && wtRaw.startsWith(beforeRepo)) {
            terminal.worktreePath = `${afterRepo}${wtRaw.slice(beforeRepo.length)}`;
            changes.push({
              field: `terminals[].worktreePath`,
              terminalId: terminal.id,
              from: wtRaw,
              to: terminal.worktreePath,
              reason: 'repo_prefix_migration'
            });
          }
        }

        // Worktree paths can also be stale even when repo root exists; fix when parent exists.
        const wt = String(terminal.worktreePath || '').trim();
        const candidate = removeExtraHytopiaGamesSegment(wt);
        if (wt && candidate) {
          const parent = path.dirname(candidate);
          if (candidate !== wt && fsSync.existsSync(parent)) {
            terminal.worktreePath = candidate;
            changes.push({
              field: `terminals[].worktreePath`,
              terminalId: terminal.id,
              from: wt,
              to: candidate,
              reason: 'remove_extra_hytopia_games_segment_parent_exists'
            });
          }
        }

        const fixedWt = tryFixPath(terminal.worktreePath);
        if (fixedWt.changed) {
          terminal.worktreePath = fixedWt.value;
          changes.push({ field: `terminals[].worktreePath`, terminalId: terminal.id, from: fixedWt.from, to: fixedWt.to, reason: fixedWt.reason });
        }
      }
    }

    return { workspace: next, changed: changes.length > 0, changes };
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
      logger.warn('Dynamic workspace discovery failed, using fallbacks', { error: error.message, stack: error.stack });
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
        logger.error('Failed to load config', { error: error.message, stack: error.stack });
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
          url: process.env.GITHUB_USERNAME ? `https://github.com/${process.env.GITHUB_USERNAME}` : 'https://github.com',
          icon: '💻'
        },
        {
          label: 'Claude Code Docs',
          url: 'https://docs.claude.com',
          icon: '📚'
        }
      ],
      server: {
        port: process.env.ORCHESTRATOR_PORT || 3000,
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
        username: process.env.GITHUB_USERNAME || null,
        teammates: []
      }
    };
  }

  async saveConfig() {
    const configFile = path.join(this.configPath, 'config.json');
    try {
      await fs.writeFile(configFile, JSON.stringify(this.config, null, 2));
      logger.info('Saved orchestrator config');
    } catch (error) {
      logger.error('Failed to save config', { error: error.message, stack: error.stack });
    }
  }

  async initializeActiveWorkspace() {
    // Priority:
    // 1. Config specifies active workspace
    // 2. Remember last workspace (from session)
    // 3. First available workspace
    // 4. None (show dashboard)

    const rememberLastWorkspace = this.config?.ui?.rememberLastWorkspace !== false;
    const configuredWorkspaceId = String(this.config?.activeWorkspace || '').trim();

    if (rememberLastWorkspace && configuredWorkspaceId && this.workspaces.has(configuredWorkspaceId)) {
      this.activeWorkspace = this.workspaces.get(configuredWorkspaceId);
      logger.info(`Set active workspace from config: ${this.activeWorkspace.name}`);
      return;
    }

    if (rememberLastWorkspace && configuredWorkspaceId && !this.workspaces.has(configuredWorkspaceId)) {
      logger.warn(`Configured active workspace missing: ${configuredWorkspaceId}`);
    }

    if (rememberLastWorkspace && this.workspaces.size > 0) {
      const sorted = Array.from(this.workspaces.values())
        .sort((a, b) => {
          const aTime = a.lastAccess ? new Date(a.lastAccess).getTime() : 0;
          const bTime = b.lastAccess ? new Date(b.lastAccess).getTime() : 0;
          return bTime - aTime;
        });
      const firstWorkspace = sorted[0];
      this.activeWorkspace = firstWorkspace;
      logger.info(`Set active workspace by fallback: ${this.activeWorkspace.name}`);
      return;
    }

    logger.info('No active workspace set (no workspaces available)');
  }

  async switchWorkspace(workspaceId) {
    logger.info(`Switching to workspace: ${workspaceId}`);

    if (!this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const newWorkspace = this.workspaces.get(workspaceId);
    const nowIso = new Date().toISOString();

    // Save session states for current workspace (if any)
    if (this.activeWorkspace) {
      await this.saveSessionStates(this.activeWorkspace.id);
    }

    // Set new active workspace
    this.activeWorkspace = newWorkspace;

    // Update config
    this.config.activeWorkspace = workspaceId;
    await this.saveConfig();

    // Track last access time for dashboard "Last used" display
    // Persist so it survives refresh/restart.
    try {
      const updatedWorkspace = await this.updateWorkspace(workspaceId, { lastAccess: nowIso });
      this.activeWorkspace = updatedWorkspace;
      logger.info(`Switched to workspace: ${updatedWorkspace.name}`);
      return updatedWorkspace;
    } catch (error) {
      logger.warn('Failed to persist workspace lastAccess', { workspaceId, error: error.message });
    }

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

  /**
   * Reload workspaces from disk (picks up new/modified workspace files)
   */
  async reloadWorkspaces() {
    logger.info('Reloading workspaces from disk');
    this.workspaces.clear();
    await this.loadWorkspaces();
    logger.info(`Reloaded ${this.workspaces.size} workspaces from disk`);
    return this.workspaces.size;
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

    // Sort by lastAccess descending (most recently used first).
    workspaces.sort((a, b) => {
      const aTime = a.lastAccess ? new Date(a.lastAccess).getTime() : 0;
      const bTime = b.lastAccess ? new Date(b.lastAccess).getTime() : 0;
      return bTime - aTime;
    });

    // Attach any recent health/cleanup info (best-effort; not persisted).
    return workspaces.map((ws) => {
      const health = this.workspaceHealth.get(ws.id) || null;
      return health ? { ...ws, health } : ws;
    });
  }

  async listWorkspacesEnriched(requestingUser = null) {
    const workspaces = this.listWorkspaces(requestingUser);

    // Best-effort: enrich repo access/visibility without blocking indefinitely.
    const refreshTasks = [];
    const now = Date.now();
    const refreshAfterMs = 7 * 24 * 60 * 60 * 1000; // 7d

    for (const workspace of workspaces) {
      const remote = workspace?.repository?.remote;
      if (!remote) continue;

      const fetchedAt = workspace.accessFetchedAt ? Date.parse(workspace.accessFetchedAt) : 0;
      const isStale = !fetchedAt || Number.isNaN(fetchedAt) || (now - fetchedAt) > refreshAfterMs;
      if (!isStale) continue;

      refreshTasks.push(async () => {
        const visibility = await this.githubRepoService.getRepoVisibility(remote);
        if (!visibility) return;

        const updates = {
          access: visibility,
          accessFetchedAt: new Date().toISOString()
        };

        // Persist only if it changed or was missing.
        const currentAccess = (workspace.access || '').toLowerCase();
        if (currentAccess !== visibility || !workspace.accessFetchedAt) {
          await this.updateWorkspace(workspace.id, updates);
        }
      });
    }

    // Concurrency limit to avoid spawning too many `gh` calls.
    const limit = 4;
    const runners = [];
    let i = 0;

    const runNext = async () => {
      const fn = refreshTasks[i];
      i += 1;
      if (!fn) return;
      try {
        await fn();
      } catch {
        // Best-effort only.
      }
      return runNext();
    };

    for (let j = 0; j < Math.min(limit, refreshTasks.length); j += 1) {
      runners.push(runNext());
    }

    await Promise.all(runners);
    return this.listWorkspaces(requestingUser);
  }

  getWorkspaceFilePath(workspaceId) {
    return path.join(this.workspacesPath, `${workspaceId}.json`);
  }

  getDeletedWorkspaceEntryPath(deletedId) {
    return path.join(this.deletedWorkspacesPath, `${deletedId}.json`);
  }

  async readDeletedWorkspaceEntry(entryName) {
    const deletedId = String(entryName || '').trim().replace(/\.json$/i, '');
    if (!deletedId) {
      throw new Error('deletedId is required');
    }

    const filePath = this.getDeletedWorkspaceEntryPath(deletedId);
    const raw = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    const workspace = payload?.workspace && typeof payload.workspace === 'object'
      ? payload.workspace
      : payload;

    if (!workspace || typeof workspace !== 'object' || !workspace.id) {
      throw new Error(`Invalid deleted workspace entry: ${deletedId}`);
    }

    return {
      deletedId,
      deletedAt: String(payload?.deletedAt || '').trim() || null,
      filePath,
      workspace
    };
  }

  async listDeletedWorkspaces() {
    const files = await fs.readdir(this.deletedWorkspacesPath).catch(() => []);
    const deletedEntries = [];

    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const filePath = path.join(this.deletedWorkspacesPath, file);
        const stats = await fs.stat(filePath).catch(() => null);
        const entry = await this.readDeletedWorkspaceEntry(file);
        deletedEntries.push({
          ...entry,
          deletedAt: entry.deletedAt || (stats?.mtime ? new Date(stats.mtime).toISOString() : null),
          restoreAvailable: !this.workspaces.has(entry.workspace.id)
        });
      } catch (error) {
        logger.warn('Failed to read deleted workspace entry', {
          file,
          error: error.message
        });
      }
    }

    deletedEntries.sort((a, b) => {
      const aTime = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const bTime = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return bTime - aTime;
    });

    return deletedEntries.map(({ workspace, deletedId, deletedAt, restoreAvailable }) => ({
      ...workspace,
      deletedId,
      deletedAt,
      restoreAvailable
    }));
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

  normalizeWorkspaceId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  resolveWorkspaceTypeForProject(repositoryType) {
    const normalized = String(repositoryType || '').trim().toLowerCase();
    const map = {
      'hytopia-game': 'hytopia-game',
      'monogame-game': 'monogame-game',
      website: 'website',
      writing: 'writing',
      'tool-project': 'tool-project',
      generic: 'tool-project'
    };
    const candidate = map[normalized] || 'tool-project';
    const all = this.getAllWorkspaceTypes();
    if (all[candidate]) return candidate;
    return 'tool-project';
  }

  async createProjectWorkspace(options = {}) {
    const rawName = String(options.name || options.projectName || '').trim();
    if (!rawName) {
      throw new Error('name is required');
    }

    const requestedWorktreeCount = Number(options.worktreeCount || options.worktrees || 0);
    const safeWorktreeCount = Number.isFinite(requestedWorktreeCount) && requestedWorktreeCount > 0
      ? Math.min(16, Math.max(1, Math.round(requestedWorktreeCount)))
      : 1;

    const requestedCategory = String(options.category || options.categoryId || '').trim() || null;
    const requestedFramework = String(options.framework || options.frameworkId || '').trim() || null;
    const requestedTemplate = String(options.template || options.templateId || '').trim() || null;

    logger.info('Creating project workspace', {
      name: rawName,
      category: requestedCategory,
      framework: requestedFramework,
      template: requestedTemplate,
      worktreeCount: safeWorktreeCount,
      createGithub: options.createGithub !== undefined ? options.createGithub : true,
      spawnClaude: options.spawnClaude === true
    });

    try {
      const project = await createProject({
        name: rawName,
        description: String(options.description || '').trim(),
        category: options.category || options.categoryId,
        framework: options.framework || options.frameworkId,
        template: options.template || options.templateId,
        basePath: options.basePath,
        repo: options.repo,
        githubOrg: options.githubOrg || options.github_org,
        createGithub: options.createGithub !== undefined ? options.createGithub : true,
        private: options.isPrivate !== undefined ? options.isPrivate : options.private,
        push: options.push !== undefined ? options.push : true,
        initGit: options.initGit !== undefined ? options.initGit : true,
        worktreeCount: safeWorktreeCount,
        allowGitHubFailure: options.allowGitHubFailure !== false,
        logger
      });

      const workspaceId = this.normalizeWorkspaceId(options.workspaceId || project.name);
      if (!workspaceId) {
        throw new Error('Failed to derive workspace id');
      }
      if (this.workspaces.has(workspaceId)) {
        throw new Error(`Workspace ID already exists: ${workspaceId}`);
      }

      const workspaceType = this.resolveWorkspaceTypeForProject(project.repositoryType);
      const workspaceName = String(options.workspaceName || rawName).trim() || rawName;
      const pairs = Math.max(1, Math.min(16, safeWorktreeCount));

      const workspace = {
        id: workspaceId,
        name: workspaceName,
        type: workspaceType,
        repository: {
          path: project.projectPath,
          masterBranch: 'master',
          remote: project.remoteUrl || undefined
        },
        worktrees: {
          enabled: true,
          count: pairs,
          namingPattern: 'work{n}',
          autoCreate: true // auto-create worktrees when workspace is first opened
        },
        terminals: {
          pairs
        }
      };

      await this.createWorkspace(workspace);
      const createdWorkspace = this.getWorkspace(workspaceId);
      logger.info('Project workspace created', {
        name: rawName,
        workspaceId,
        workspaceType,
        projectPath: project.projectPath,
        templateId: project.templateId || requestedTemplate,
        frameworkId: project.frameworkId || requestedFramework,
        categoryId: project.categoryId || requestedCategory,
        remoteUrl: project.remoteUrl || null,
        warnings: Array.isArray(project.warnings) ? project.warnings.length : 0
      });

      return {
        success: true,
        project,
        workspace: createdWorkspace
      };
    } catch (error) {
      logger.error('Failed to create project workspace', {
        name: rawName,
        category: requestedCategory,
        framework: requestedFramework,
        template: requestedTemplate,
        worktreeCount: safeWorktreeCount,
        error: error.message
      });
      throw error;
    }
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

    const workspace = this.workspaces.get(workspaceId);
    const filePath = this.getWorkspaceFilePath(workspaceId);
    const deletedAt = new Date().toISOString();
    const deletedId = `${this.normalizeWorkspaceId(workspaceId) || 'workspace'}-${Date.now()}`;
    const deletedEntryPath = this.getDeletedWorkspaceEntryPath(deletedId);

    await fs.writeFile(deletedEntryPath, JSON.stringify({
      deletedId,
      deletedAt,
      workspace
    }, null, 2));

    await fs.unlink(filePath).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });

    // Remove from memory
    this.workspaces.delete(workspaceId);
    this.workspaceHealth.delete(workspaceId);
    if (this.activeWorkspace?.id === workspaceId) {
      this.activeWorkspace = null;
    }

    logger.info(`Deleted workspace: ${workspaceId}`, { deletedId });

    return {
      deletedId,
      deletedAt,
      workspace
    };
  }

  async restoreWorkspace(deletedId) {
    const entry = await this.readDeletedWorkspaceEntry(deletedId);
    const workspaceId = String(entry?.workspace?.id || '').trim();

    if (!workspaceId) {
      throw new Error(`Deleted workspace entry is missing an id: ${deletedId}`);
    }

    if (this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace already exists: ${workspaceId}`);
    }

    const normalize = this.normalizeWorkspacePaths(entry.workspace);
    const sanitized = this.sanitizeWorkspaceTerminals(normalize.workspace);
    const restoredWorkspace = sanitized.workspace;
    const validation = validateWorkspace(restoredWorkspace);
    if (!validation.valid) {
      throw new Error(`Invalid workspace config: ${validation.errors.join(', ')}`);
    }

    await this.enrichWorkspaceRepositoryTypes(restoredWorkspace);
    await fs.writeFile(this.getWorkspaceFilePath(workspaceId), JSON.stringify(restoredWorkspace, null, 2));
    await fs.unlink(entry.filePath).catch(() => {});

    this.workspaces.set(workspaceId, restoredWorkspace);
    this.workspaceHealth.delete(workspaceId);

    logger.info('Restored deleted workspace', {
      workspaceId,
      deletedId
    });

    return restoredWorkspace;
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
