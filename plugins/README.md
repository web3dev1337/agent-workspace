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

## Client UI slots (`client.slots`)

A plugin can add buttons to named UI slots via the manifest — no client JavaScript needed:

```json
{
  "client": {
    "slots": [
      {
        "id": "open-board",
        "slot": "commander.tools",
        "label": "🎬 My Tool",
        "description": "Tooltip text",
        "order": 10,
        "action": { "type": "post_route", "route": "/api/plugins/my-plugin/run", "prompt": "Input value:", "field": "value" }
      }
    ]
  }
}
```

Slots the client currently renders:
- `commander.tools` — button strip in the Commander panel (between toolbar and terminal).
- `dashboard.telemetry.actions` — action row in the dashboard Telemetry overlay.

Action types:
- `open_url` `{ url }` — opens an external `https?://` URL in a new tab.
- `open_route` `{ route }` — opens a local route (must start with `/`).
- `copy_text` `{ text }` — copies text to the clipboard.
- `commander_action` `{ commanderAction, payload? }` — runs a command-catalog action.
- `post_route` `{ route, prompt?, field?, payload? }` — POSTs JSON to a local route; if `prompt` is set the user is asked for one input first, sent as `field` (default `value`). The route's JSON response `message`/`error` is surfaced in the UI.

## Example plugin

`plugins/youtube-transcript/` is a complete working example: a `post_route` button in `commander.tools` plus a `youtube-transcript-transcribe` command that fetches a video's subtitles via `yt-dlp` and saves a plain-text transcript to `~/Downloads/transcripts/`.

## Managing plugins

Settings → Plugins lists loaded and **failed** plugins (a bad manifest no longer fails silently) and has a Reload button.
