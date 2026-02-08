# Plugins (server-side v1)

Place plugins in this folder, one directory per plugin:

```
plugins/
  my-plugin/
    plugin.json
    server.js
```

## `plugin.json` (optional)

```json
{
  "manifestVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Example plugin",
  "serverEntry": "server.js",
  "capabilities": {
    "routes": true,
    "commands": true,
    "surfaces": ["commander", "voice", "ui", "scheduler"],
    "maxCommands": 64
  },
  "compatibility": {
    "minNodeVersion": "20.0.0",
    "minOrchestratorVersion": "1.0.0"
  }
}
```

Rules:
- `manifestVersion` must currently be `1`.
- `id` (if provided) must match the plugin folder name.
- `serverEntry` must be a relative file path inside the plugin directory.
- `capabilities.maxCommands` is validated (`1..500`).
- command names are auto-prefixed with `<pluginId>-` and collisions are rejected.
- unsupported command surfaces are rejected at load time.

## `server.js` entry

```js
module.exports = async function register({ router, registerCommand }) {
  router.get('/healthz', (req, res) => res.json({ ok: true }));

  registerCommand('ping', {
    category: 'plugin',
    description: 'Plugin ping command',
    params: [],
    examples: [],
    handler: async () => ({ message: 'pong' })
  });
};
```

## Runtime APIs

- `GET /api/plugins` shows loaded/failed plugins.
- `POST /api/plugins/reload` reloads plugins from disk.
- Plugin routes are mounted under `/api/plugins/<pluginId>/*`.
