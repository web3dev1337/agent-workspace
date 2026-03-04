const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { PluginLoaderService } = require('../../server/pluginLoaderService');

describe('PluginLoaderService', () => {
  test('loads plugin route and registers namespaced command', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-plugin-test-'));
    const pluginDir = path.join(tmpDir, 'demo');
    fs.mkdirSync(pluginDir, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'Demo plugin',
      version: '0.1.0',
      serverEntry: 'server.js'
    }));

    fs.writeFileSync(path.join(pluginDir, 'server.js'), `
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
    `);

    const app = express();
    const commandRegistry = { register: jest.fn() };
    const service = new PluginLoaderService({ pluginsDir: tmpDir, logger: { info: () => {}, warn: () => {}, error: () => {} } });

    const status = await service.loadAll({ app, commandRegistry, services: {} });

    expect(Array.isArray(status.loaded)).toBe(true);
    expect(status.loaded.length).toBe(1);
    expect(status.loaded[0].id).toBe('demo');
    expect(commandRegistry.register).toHaveBeenCalled();
    expect(commandRegistry.register.mock.calls[0][0]).toBe('demo-ping');
  });
});
