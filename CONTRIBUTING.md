# Contributing

## Workflow

1. Create a branch from `origin/main`.
2. Make focused changes (small PRs preferred).
3. Run tests for touched areas (at minimum `npm run test:unit`).
4. Run public-release safety checks:
   - `npm run audit:public-release`
   - `npm run audit:public-release:history` (requires `gitleaks`)
5. Push branch and open a PR.

```bash
git fetch origin
git checkout -b feat/my-change origin/main
npm run test:unit
npm run audit:public-release
git add -A
git commit -m "feat: short summary"
git push -u origin feat/my-change
gh pr create --fill
```

## Development

- Start web mode:
  - `npm run dev`
- Start full mode (web + Tauri):
  - `npm run dev:full`

## Coding conventions

- Keep changes scoped to the requested behavior.
- Prefer semantic server commands (`server/commandRegistry.js`) over UI-only one-offs.
- Keep cross-platform behavior in mind (`server/*` must work on Linux, WSL, and Windows).
- Never commit secrets (`.env`, tokens, private keys).

## Plugin development (server-side v1)

- Plugin root defaults to `plugins/` (or `ORCHESTRATOR_PLUGINS_DIR`).
- Each plugin directory may include:
  - `plugin.json` (optional metadata)
  - `server.js` (entry point)
- Plugins are loaded at startup and mounted under:
  - `/api/plugins/<pluginId>/*`
- Plugins can register namespaced commands via `registerCommand(name, config)` passed to their register function.

Minimal `server.js` example:

```js
module.exports = async function register({ router, registerCommand }) {
  router.get('/hello', (req, res) => res.json({ ok: true }));

  registerCommand('ping', {
    category: 'plugin',
    description: 'Health check for this plugin',
    params: [],
    examples: [],
    handler: async () => ({ message: 'pong' })
  });
};
```

## Scheduler (automation)

- Scheduler config is stored in user settings under `global.scheduler`.
- Runtime APIs:
  - `GET /api/scheduler/status`
  - `PUT /api/scheduler/config`
  - `POST /api/scheduler/run-now`
- Use safe commands by default. Dangerous commands should require explicit schedule-level opt-in.
