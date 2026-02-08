const fs = require('fs');
const path = require('path');
const express = require('express');

class PluginLoaderService {
  constructor({
    pluginsDir = process.env.ORCHESTRATOR_PLUGINS_DIR || path.join(__dirname, '..', 'plugins'),
    logger = console
  } = {}) {
    this.pluginsDir = String(pluginsDir || '').trim();
    this.logger = logger;
    this.loadedPlugins = [];
    this.failedPlugins = [];
    this.lastLoadedAt = null;
    this.supportedManifestVersions = new Set([1]);
    this.allowedCommandSurfaces = new Set(['commander', 'voice', 'ui', 'scheduler']);
    this.allowedClientActionTypes = new Set(['open_url', 'open_route', 'copy_text', 'commander_action']);
    this.orchestratorVersion = this.loadOrchestratorVersion();
  }

  static getInstance(options = {}) {
    if (!PluginLoaderService.instance) {
      PluginLoaderService.instance = new PluginLoaderService(options);
    }
    return PluginLoaderService.instance;
  }

  getStatus() {
    return {
      pluginsDir: this.pluginsDir,
      lastLoadedAt: this.lastLoadedAt,
      loaded: this.loadedPlugins,
      failed: this.failedPlugins
    };
  }

  async loadAll({ app, commandRegistry, services = {} } = {}) {
    if (!app) throw new Error('Plugin loader requires app');

    this.loadedPlugins = [];
    this.failedPlugins = [];
    this.lastLoadedAt = new Date().toISOString();

    if (!this.pluginsDir || !fs.existsSync(this.pluginsDir)) {
      this.logger.info?.('Plugin directory not found, skipping plugin load', { pluginsDir: this.pluginsDir });
      return this.getStatus();
    }

    let entries = [];
    try {
      entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    } catch (error) {
      this.logger.error?.('Failed to read plugins directory', { pluginsDir: this.pluginsDir, error: error.message });
      this.failedPlugins.push({
        id: '(scan)',
        error: error.message
      });
      return this.getStatus();
    }

    const dirs = entries.filter((entry) => entry?.isDirectory?.());
    for (const dirEntry of dirs) {
      const pluginId = String(dirEntry.name || '').trim();
      if (!pluginId) continue;
      await this.loadOne(pluginId, { app, commandRegistry, services });
    }

    return this.getStatus();
  }

  async loadOne(pluginId, { app, commandRegistry, services = {} } = {}) {
    const id = String(pluginId || '').trim();
    if (!id) return null;
    const safePluginId = this.normalizePluginId(id);
    if (!safePluginId) {
      const error = 'Plugin directory name must use [a-z0-9-]';
      this.failedPlugins.push({ id, error });
      this.logger.warn?.('Skipping plugin (invalid id)', { pluginId: id });
      return null;
    }
    const pluginDir = path.join(this.pluginsDir, id);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const fallbackEntry = path.join(pluginDir, 'server.js');

    let manifest = this.getDefaultManifest(safePluginId);
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest = this.normalizeManifest(safePluginId, parsed, manifestPath);
      } catch (error) {
        const message = String(error?.message || error);
        this.failedPlugins.push({ id: safePluginId, error: message });
        this.logger.warn?.('Skipping plugin (invalid manifest)', {
          pluginId: id,
          manifestPath,
          error: message
        });
        return null;
      }
    }

    const serverEntryRel = String(manifest.serverEntry || 'server.js').trim();
    const serverEntryPath = path.resolve(pluginDir, serverEntryRel || 'server.js');
    const entryExists = fs.existsSync(serverEntryPath);
    if (!entryExists) {
      if (fs.existsSync(fallbackEntry)) {
        return this.loadOneWithEntry(safePluginId, fallbackEntry, manifest, { app, commandRegistry, services });
      }

      this.failedPlugins.push({
        id: safePluginId,
        error: `Missing entry file (${serverEntryRel})`
      });
      this.logger.warn?.('Skipping plugin (entry missing)', { pluginId: id, serverEntryPath });
      return null;
    }

    return this.loadOneWithEntry(safePluginId, serverEntryPath, manifest, { app, commandRegistry, services });
  }

  async loadOneWithEntry(id, entryPath, manifest, { app, commandRegistry, services = {} } = {}) {
    try {
      this.assertManifestCompatibility(id, manifest);
      delete require.cache[require.resolve(entryPath)];
      const pluginModule = require(entryPath);
      const register =
        (typeof pluginModule === 'function' && pluginModule)
        || (pluginModule && typeof pluginModule.register === 'function' && pluginModule.register)
        || (pluginModule?.default && typeof pluginModule.default === 'function' && pluginModule.default)
        || null;

      if (!register) {
        throw new Error('Plugin must export a function or { register() }');
      }

      const router = express.Router();
      const routeBase = `/api/plugins/${encodeURIComponent(id)}`;
      const commandPrefix = `${id}-`;
      const capabilities = manifest?.capabilities || {};
      const allowRoutes = capabilities.routes !== false;
      const allowCommands = capabilities.commands !== false;
      const allowedSurfaces = this.normalizeSurfaceList(capabilities.surfaces);
      const maxCommands = Number.isInteger(capabilities.maxCommands) ? capabilities.maxCommands : 64;
      if (maxCommands < 1 || maxCommands > 500) {
        throw new Error(`Invalid capabilities.maxCommands (${capabilities.maxCommands})`);
      }
      const registeredCommands = new Set();
      const registerCommand = (name, config) => {
        if (!allowCommands) {
          throw new Error('Plugin manifest disables command registration (capabilities.commands=false)');
        }
        if (!commandRegistry || typeof commandRegistry.register !== 'function') {
          return null;
        }
        const raw = String(name || '').trim().toLowerCase();
        if (!raw) throw new Error('Plugin command name is required');
        const safe = raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!safe) throw new Error(`Invalid plugin command name: ${name}`);
        const commandName = safe.startsWith(commandPrefix) ? safe : `${commandPrefix}${safe}`;
        if (registeredCommands.has(commandName)) {
          throw new Error(`Plugin attempted to register duplicate command: ${commandName}`);
        }
        if (registeredCommands.size >= maxCommands) {
          throw new Error(`Plugin exceeded command limit (${maxCommands})`);
        }
        if (typeof commandRegistry.getCommand === 'function' && commandRegistry.getCommand(commandName)) {
          throw new Error(`Plugin command already exists: ${commandName}`);
        }

        const cfg = { ...(config || {}) };
        if (Array.isArray(cfg.surfaces)) {
          const requested = this.normalizeSurfaceList(cfg.surfaces);
          if (allowedSurfaces.length) {
            const disallowed = requested.filter((surface) => !allowedSurfaces.includes(surface));
            if (disallowed.length) {
              throw new Error(`Plugin command surfaces not allowed by manifest: ${disallowed.join(', ')}`);
            }
          }
          cfg.surfaces = requested;
        } else if (allowedSurfaces.length) {
          cfg.surfaces = [...allowedSurfaces];
        }

        commandRegistry.register(commandName, cfg);
        registeredCommands.add(commandName);
        return commandName;
      };

      if (allowRoutes) {
        router.get('/health', (req, res) => {
          res.json({
            ok: true,
            pluginId: id,
            version: String(manifest?.version || ''),
            loadedAt: new Date().toISOString()
          });
        });
      }

      await register({
        pluginId: id,
        manifest: manifest || {},
        logger: this.logger,
        router,
        app,
        routeBase,
        registerCommand,
        commandRegistry,
        services
      });

      if (allowRoutes) app.use(routeBase, router);

      const loaded = {
        id,
        name: String(manifest?.name || id),
        version: String(manifest?.version || ''),
        description: String(manifest?.description || ''),
        routeBase,
        entryPath,
        capabilities: {
          routes: allowRoutes,
          commands: allowCommands,
          surfaces: allowedSurfaces.length ? allowedSurfaces : null,
          maxCommands
        },
        client: {
          slots: Array.isArray(manifest?.client?.slots) ? manifest.client.slots : []
        },
        loadedAt: new Date().toISOString()
      };
      this.loadedPlugins.push(loaded);
      this.logger.info?.('Loaded plugin', { pluginId: id, routeBase, entryPath });
      return loaded;
    } catch (error) {
      const failed = {
        id,
        entryPath,
        error: String(error?.message || error)
      };
      this.failedPlugins.push(failed);
      this.logger.error?.('Failed to load plugin', { pluginId: id, entryPath, error: failed.error });
      return null;
    }
  }

  normalizePluginId(pluginId) {
    const value = String(pluginId || '').trim().toLowerCase();
    if (!value) return '';
    return /^[a-z0-9][a-z0-9-]*$/.test(value) ? value : '';
  }

  getDefaultManifest(pluginId) {
    return {
      id: pluginId,
      name: pluginId,
      version: '0.0.0',
      description: '',
      manifestVersion: 1,
      serverEntry: 'server.js',
      capabilities: {
        commands: true,
        routes: true,
        surfaces: [],
        maxCommands: 64
      },
      client: {
        slots: []
      },
      compatibility: {}
    };
  }

  normalizeSurfaceList(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    for (const item of input) {
      const surface = String(item || '').trim().toLowerCase();
      if (!surface) continue;
      if (!this.allowedCommandSurfaces.has(surface)) {
        throw new Error(`Unsupported command surface: ${surface}`);
      }
      if (!out.includes(surface)) out.push(surface);
    }
    return out;
  }

  normalizeClientSlots(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seenIds = new Set();
    for (const item of input) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Each client slot entry must be an object');
      }
      const id = String(item.id || '').trim().toLowerCase();
      const slot = String(item.slot || '').trim().toLowerCase();
      const label = String(item.label || '').trim();
      const description = String(item.description || '').trim();
      if (!id || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(id)) throw new Error(`Invalid client slot id: ${item.id}`);
      if (seenIds.has(id)) throw new Error(`Duplicate client slot id: ${id}`);
      if (!slot || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(slot)) throw new Error(`Invalid client slot target: ${item.slot}`);
      if (!label) throw new Error(`Missing client slot label for id: ${id}`);

      const action = item.action;
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`Missing client action for slot id: ${id}`);
      }
      const type = String(action.type || '').trim().toLowerCase();
      if (!this.allowedClientActionTypes.has(type)) throw new Error(`Unsupported client action type: ${action.type}`);

      const normalizedAction = { type };
      if (type === 'open_url') {
        const url = String(action.url || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid open_url action url for slot id: ${id}`);
        normalizedAction.url = url;
      }
      if (type === 'open_route') {
        const route = String(action.route || '').trim();
        if (!route || !route.startsWith('/')) throw new Error(`Invalid open_route action route for slot id: ${id}`);
        normalizedAction.route = route;
      }
      if (type === 'copy_text') {
        normalizedAction.text = String(action.text || '');
      }
      if (type === 'commander_action') {
        const commanderAction = String(action.commanderAction || action.action || '').trim();
        if (!commanderAction) throw new Error(`Missing commanderAction for slot id: ${id}`);
        normalizedAction.commanderAction = commanderAction;
        if (action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)) {
          normalizedAction.payload = action.payload;
        }
      }

      const order = Number(item.order);
      out.push({
        id,
        slot,
        label,
        description,
        order: Number.isFinite(order) ? order : 0,
        action: normalizedAction
      });
      seenIds.add(id);
    }
    return out.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  }

  normalizeManifest(pluginId, manifest, manifestPath) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(`Manifest must be an object (${manifestPath})`);
    }
    const normalized = this.getDefaultManifest(pluginId);
    const manifestVersionRaw = manifest.manifestVersion ?? 1;
    const manifestVersion = Number(manifestVersionRaw);
    if (!Number.isInteger(manifestVersion) || !this.supportedManifestVersions.has(manifestVersion)) {
      throw new Error(`Unsupported manifestVersion: ${manifestVersionRaw}`);
    }
    normalized.manifestVersion = manifestVersion;

    const explicitId = String(manifest.id || '').trim().toLowerCase();
    if (explicitId) {
      const safeId = this.normalizePluginId(explicitId);
      if (!safeId) throw new Error(`Invalid manifest id: ${manifest.id}`);
      if (safeId !== pluginId) throw new Error(`Manifest id mismatch: ${safeId} != ${pluginId}`);
      normalized.id = safeId;
    }

    const name = String(manifest.name || '').trim();
    if (name) normalized.name = name;
    const version = String(manifest.version || '').trim();
    if (version) {
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Invalid manifest version string: ${version}`);
      }
      normalized.version = version;
    }
    const description = String(manifest.description || '').trim();
    if (description) normalized.description = description;

    const serverEntry = String(manifest.serverEntry || normalized.serverEntry).trim();
    if (!serverEntry) throw new Error('Manifest serverEntry cannot be empty');
    if (path.isAbsolute(serverEntry)) throw new Error('Manifest serverEntry must be a relative path');
    const parts = serverEntry.split(/[\\/]+/).filter(Boolean);
    if (parts.includes('..')) throw new Error('Manifest serverEntry cannot traverse directories');
    normalized.serverEntry = serverEntry;

    const caps = manifest.capabilities;
    if (caps !== undefined) {
      if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
        throw new Error('Manifest capabilities must be an object');
      }
      if (caps.commands !== undefined) normalized.capabilities.commands = caps.commands !== false;
      if (caps.routes !== undefined) normalized.capabilities.routes = caps.routes !== false;
      if (caps.surfaces !== undefined) normalized.capabilities.surfaces = this.normalizeSurfaceList(caps.surfaces);
      if (caps.maxCommands !== undefined) {
        const maxCommands = Number(caps.maxCommands);
        if (!Number.isInteger(maxCommands) || maxCommands < 1 || maxCommands > 500) {
          throw new Error(`Invalid capabilities.maxCommands: ${caps.maxCommands}`);
        }
        normalized.capabilities.maxCommands = maxCommands;
      }
    }

    const client = manifest.client;
    if (client !== undefined) {
      if (!client || typeof client !== 'object' || Array.isArray(client)) {
        throw new Error('Manifest client must be an object');
      }
      normalized.client = {
        slots: this.normalizeClientSlots(client.slots || [])
      };
    }

    const compatibility = manifest.compatibility;
    if (compatibility !== undefined) {
      if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) {
        throw new Error('Manifest compatibility must be an object');
      }
      const minNodeVersion = String(compatibility.minNodeVersion || '').trim();
      const minOrchestratorVersion = String(compatibility.minOrchestratorVersion || '').trim();
      if (minNodeVersion) {
        if (!this.isSemverLike(minNodeVersion)) throw new Error(`Invalid compatibility.minNodeVersion: ${minNodeVersion}`);
        normalized.compatibility.minNodeVersion = minNodeVersion;
      }
      if (minOrchestratorVersion) {
        if (!this.isSemverLike(minOrchestratorVersion)) {
          throw new Error(`Invalid compatibility.minOrchestratorVersion: ${minOrchestratorVersion}`);
        }
        normalized.compatibility.minOrchestratorVersion = minOrchestratorVersion;
      }
    }

    return normalized;
  }

  isSemverLike(value) {
    return /^[0-9]+(\.[0-9]+){0,2}$/.test(String(value || '').trim());
  }

  parseVersionTriplet(value) {
    const parts = String(value || '0.0.0')
      .trim()
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  }

  compareVersion(a, b) {
    const [a0, a1, a2] = this.parseVersionTriplet(a);
    const [b0, b1, b2] = this.parseVersionTriplet(b);
    if (a0 !== b0) return a0 - b0;
    if (a1 !== b1) return a1 - b1;
    return a2 - b2;
  }

  assertManifestCompatibility(pluginId, manifest) {
    const minNodeVersion = String(manifest?.compatibility?.minNodeVersion || '').trim();
    const minOrchestratorVersion = String(manifest?.compatibility?.minOrchestratorVersion || '').trim();
    if (minNodeVersion) {
      const currentNode = String(process.versions?.node || '0.0.0').trim();
      if (this.compareVersion(currentNode, minNodeVersion) < 0) {
        throw new Error(`Plugin ${pluginId} requires Node >= ${minNodeVersion} (current ${currentNode})`);
      }
    }
    if (minOrchestratorVersion) {
      const currentOrchestrator = String(this.orchestratorVersion || '0.0.0').trim();
      if (this.compareVersion(currentOrchestrator, minOrchestratorVersion) < 0) {
        throw new Error(`Plugin ${pluginId} requires orchestrator >= ${minOrchestratorVersion} (current ${currentOrchestrator})`);
      }
    }
  }

  loadOrchestratorVersion() {
    try {
      const packagePath = path.join(__dirname, '..', 'package.json');
      const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const version = String(parsed?.version || '').trim();
      if (version && /^[0-9]+(\.[0-9]+){1,2}/.test(version)) return version;
    } catch {}
    return '0.0.0';
  }
}

module.exports = { PluginLoaderService };
