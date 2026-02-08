const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { PluginLoaderService } = require('../../server/pluginLoaderService');

describe('PluginLoaderService', () => {
  function writePlugin(tmpDir, pluginId, { manifest = null, serverSource }) {
    const pluginDir = path.join(tmpDir, pluginId);
    fs.mkdirSync(pluginDir, { recursive: true });
    if (manifest) {
      fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2));
    }
    fs.writeFileSync(path.join(pluginDir, 'server.js'), serverSource);
  }

  function makeService(tmpDir) {
    return new PluginLoaderService({
      pluginsDir: tmpDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });
  }

  test('loads plugin route and registers namespaced command', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'demo', {
      manifest: {
        name: 'Demo plugin',
        version: '0.1.0',
        serverEntry: 'server.js'
      },
      serverSource: `
        module.exports = async function register({ router, registerCommand }) {
          router.get('/hello', (req, res) => res.json({ ok: true, from: 'demo' }));
          registerCommand('ping', {
            category: 'plugin',
            description: 'Ping demo plugin',
            params: [],
            examples: [],
            handler: async () => ({ message: 'pong' })
          });
        };
      `
    });

    const app = express();
    const commandRegistry = { register: jest.fn(), getCommand: jest.fn(() => null) };
    const service = makeService(tmpDir);

    const status = await service.loadAll({ app, commandRegistry, services: {} });
    expect(Array.isArray(status.loaded)).toBe(true);
    expect(status.loaded.length).toBe(1);
    expect(status.loaded[0].id).toBe('demo');
    expect(commandRegistry.register).toHaveBeenCalled();
    expect(commandRegistry.register.mock.calls[0][0]).toBe('demo-ping');
  });

  test('fails plugin load when manifestVersion is unsupported', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'badmanifest', {
      manifest: {
        manifestVersion: 2,
        name: 'Bad manifest',
        version: '0.1.0'
      },
      serverSource: `
        module.exports = async function register() {};
      `
    });

    const app = express();
    const commandRegistry = { register: jest.fn(), getCommand: jest.fn(() => null) };
    const service = makeService(tmpDir);

    const status = await service.loadAll({ app, commandRegistry, services: {} });
    expect(status.loaded).toHaveLength(0);
    expect(status.failed).toHaveLength(1);
    expect(status.failed[0].id).toBe('badmanifest');
    expect(String(status.failed[0].error || '')).toContain('Unsupported manifestVersion');
  });

  test('fails plugin load when command collides with existing command', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'demo', {
      manifest: {
        name: 'Demo plugin',
        version: '0.1.0'
      },
      serverSource: `
        module.exports = async function register({ registerCommand }) {
          registerCommand('ping', {
            category: 'plugin',
            description: 'Ping demo plugin',
            params: [],
            examples: [],
            handler: async () => ({ message: 'pong' })
          });
        };
      `
    });

    const app = express();
    const commandRegistry = {
      register: jest.fn(),
      getCommand: jest.fn((name) => (name === 'demo-ping' ? { name } : null))
    };
    const service = makeService(tmpDir);

    const status = await service.loadAll({ app, commandRegistry, services: {} });
    expect(status.loaded).toHaveLength(0);
    expect(status.failed).toHaveLength(1);
    expect(String(status.failed[0].error || '')).toContain('already exists');
    expect(commandRegistry.register).not.toHaveBeenCalled();
  });

  test('fails plugin load when maxCommands is exceeded', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'demo', {
      manifest: {
        name: 'Demo plugin',
        version: '0.1.0',
        capabilities: {
          maxCommands: 1
        }
      },
      serverSource: `
        module.exports = async function register({ registerCommand }) {
          registerCommand('one', {
            category: 'plugin',
            description: 'One',
            params: [],
            examples: [],
            handler: async () => ({ ok: true })
          });
          registerCommand('two', {
            category: 'plugin',
            description: 'Two',
            params: [],
            examples: [],
            handler: async () => ({ ok: true })
          });
        };
      `
    });

    const app = express();
    const commandRegistry = { register: jest.fn(), getCommand: jest.fn(() => null) };
    const service = makeService(tmpDir);

    const status = await service.loadAll({ app, commandRegistry, services: {} });
    expect(status.loaded).toHaveLength(0);
    expect(status.failed).toHaveLength(1);
    expect(String(status.failed[0].error || '')).toContain('command limit');
  });
});
