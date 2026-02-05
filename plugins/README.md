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
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Example plugin",
  "serverEntry": "server.js"
}
```

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
