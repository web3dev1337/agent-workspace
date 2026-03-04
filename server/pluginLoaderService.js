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
    const pluginDir = path.join(this.pluginsDir, id);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const fallbackEntry = path.join(pluginDir, 'server.js');

    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        this.logger.warn?.('Failed to parse plugin manifest; using defaults', {
          pluginId: id,
          manifestPath,
          error: error.message
        });
      }
    }

    const serverEntryRel = String(manifest.serverEntry || 'server.js').trim();
    const serverEntryPath = path.resolve(pluginDir, serverEntryRel || 'server.js');
    const entryExists = fs.existsSync(serverEntryPath);
    if (!entryExists) {
      if (fs.existsSync(fallbackEntry)) {
        return this.loadOneWithEntry(id, fallbackEntry, manifest, { app, commandRegistry, services });
      }

      this.failedPlugins.push({
        id,
        error: `Missing entry file (${serverEntryRel})`
      });
      this.logger.warn?.('Skipping plugin (entry missing)', { pluginId: id, serverEntryPath });
      return null;
    }

    return this.loadOneWithEntry(id, serverEntryPath, manifest, { app, commandRegistry, services });
  }

  async loadOneWithEntry(id, entryPath, manifest, { app, commandRegistry, services = {} } = {}) {
    try {
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
      const registerCommand = (name, config) => {
        if (!commandRegistry || typeof commandRegistry.register !== 'function') {
          return null;
        }
        const raw = String(name || '').trim().toLowerCase();
        if (!raw) throw new Error('Plugin command name is required');
        const safe = raw.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!safe) throw new Error(`Invalid plugin command name: ${name}`);
        const commandName = safe.startsWith(commandPrefix) ? safe : `${commandPrefix}${safe}`;
        commandRegistry.register(commandName, config || {});
        return commandName;
      };

      router.get('/health', (req, res) => {
        res.json({
          ok: true,
          pluginId: id,
          version: String(manifest?.version || ''),
          loadedAt: new Date().toISOString()
        });
      });

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

      app.use(routeBase, router);

      const loaded = {
        id,
        name: String(manifest?.name || id),
        version: String(manifest?.version || ''),
        description: String(manifest?.description || ''),
        routeBase,
        entryPath,
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
}

module.exports = { PluginLoaderService };
