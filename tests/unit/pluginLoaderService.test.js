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

  test('loads plugin with normalized client slots', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'clientslots', {
      manifest: {
        name: 'Client slots plugin',
        version: '0.1.0',
        client: {
          slots: [
            {
              id: 'open-board',
              slot: 'dashboard.telemetry.actions',
              label: 'Open board',
              order: 20,
              action: { type: 'open_url', url: 'https://example.com/board' }
            },
            {
              id: 'trigger-review',
              slot: 'dashboard.telemetry.actions',
              label: 'Trigger review',
              order: 10,
              action: { type: 'commander_action', commanderAction: 'open-queue', payload: { mine: true } }
            }
          ]
        }
      },
      serverSource: `
        module.exports = async function register() {};
      `
    });

    const app = express();
    const commandRegistry = { register: jest.fn(), getCommand: jest.fn(() => null) };
    const service = makeService(tmpDir);

    const status = await service.loadAll({ app, commandRegistry, services: {} });
    expect(status.failed).toHaveLength(0);
    expect(status.loaded).toHaveLength(1);
    const slots = status.loaded[0].client.slots;
    expect(Array.isArray(slots)).toBe(true);
    expect(slots).toHaveLength(2);
    expect(slots[0].id).toBe('trigger-review');
    expect(slots[0].action.type).toBe('commander_action');
    expect(slots[0].action.commanderAction).toBe('open-queue');
    expect(slots[1].id).toBe('open-board');
    expect(slots[1].action.type).toBe('open_url');
  });

  test('fails plugin load when client slot action is invalid', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'badclientslot', {
      manifest: {
        name: 'Bad client slot',
        version: '0.1.0',
        client: {
          slots: [
            {
              id: 'bad-action',
              slot: 'dashboard.telemetry.actions',
              label: 'Bad action',
              action: { type: 'open_url', url: 'javascript:alert(1)' }
            }
          ]
        }
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
    expect(String(status.failed[0].error || '')).toContain('Invalid open_url action url');
  });

  test('fails plugin load when client slot ids are duplicated', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    writePlugin(tmpDir, 'duplicateclientslot', {
      manifest: {
        name: 'Duplicate client slots',
        version: '0.1.0',
        client: {
          slots: [
            {
              id: 'same-id',
              slot: 'dashboard.telemetry.actions',
              label: 'First',
              action: { type: 'copy_text', text: 'one' }
            },
            {
              id: 'same-id',
              slot: 'dashboard.telemetry.actions',
              label: 'Second',
              action: { type: 'copy_text', text: 'two' }
            }
          ]
        }
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
    expect(String(status.failed[0].error || '')).toContain('Duplicate client slot id');
  });
});
