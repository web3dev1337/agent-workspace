# Plugin architecture + Pro gating (feasibility analysis)

Date: 2026-02-05

Goal: make “Pro / premium” features possible without turning the core into a mess, and allow future third-party modules.

This doc focuses on architecture feasibility and the minimal changes required to support:
- “open-core” premium modules
- community plugins
- future “providers” (e.g., new agent backends besides Claude/Codex)

---

## Key constraint (local-first reality)

If the core is public/open, anything enforced only in the UI is bypassable.

So:
- **Enforce entitlements on the server** (or in closed-source modules),
- treat UI gating as UX only.

---

## What we have today (useful extension points)

### Server-side

- Express server in `server/index.js` (many routes)
- “Commander” and voice control flows (commands/actions)
- Task providers / integrations (Trello, GitHub, Discord, etc.)
- Licensing scaffolding:
  - `server/licenseService.js`
  - `server/licenseMiddleware.js`

### Client-side

- A large single-file UI implementation (`client/app.js`) with UI panels and feature flags/settings
- Diff viewer is already its own separate app (`diff-viewer/client`)

This is workable, but client modularity is the main long-term risk.

---

## Minimal viable plugin system (low refactor)

### Concept

Load “plugins” from a local directory at startup:
- `plugins/<pluginId>/plugin.json`
- `plugins/<pluginId>/server.js` (optional)
- `plugins/<pluginId>/client.js` (optional, loaded by UI)

### What a plugin can register (v1)

Server-side:
- new API routes under `/api/plugins/<pluginId>/*`
- new commander actions (commands)
- new voice intents (optional)
- new task providers (Trello-like adapters)

Client-side (limited):
- new settings sections
- new panel(s) in an existing tab area

### Why this is “low refactor”

You can implement this without rewriting the whole UI by:
- loading a small set of plugin scripts dynamically (script tags)
- exposing a stable `window.OrchestratorPluginAPI` to register UI widgets

Downside:
- hard to keep plugins stable without a more formal UI framework

---

## Medium refactor (recommended if serious about plugins)

### Goal

Split the UI into modules so “panels” are first-class:
- “Queue panel”
- “Review console panel”
- “Worktree inspector”
- “Settings”

Then implement:
- a panel registry (`registerPanel({ id, title, render })`)
- a command registry (already close to this)
- a settings schema registry

This reduces the risk of `client/app.js` becoming unmaintainable.

---

## Pro gating design (practical)

### Server-side entitlements

Use `licenseService.getEntitlements()` to decide:
- which endpoints are accessible
- which automations can run
- rate limits / caps (if needed)

### Enforcement patterns

- Gate entire routes with middleware (e.g. `requirePro()`).
- Gate specific actions within a route where needed.
- Always return a clear error:
  - HTTP 402/403 with `{ code: 'pro_required', feature: '...' }`

### UI behavior

- Hide/disable Pro actions with a consistent “Pro” badge + “Upgrade” link
- If server rejects: show an upgrade modal, not a stack trace

---

## What should be “Pro” (starter list)

Good:
- automation features that incur risk (auto-merge rules, overnight queues)
- advanced dashboards / telemetry v2
- advanced diff embedding features
- team sharing / sync features

Avoid:
- basic review/manual merge
- basic worktree/terminal management

---

## Complexity / risk estimate

Low refactor (plugin scripts + server registry):
- 1–3 days for a workable v1
- higher long-term maintenance risk

Medium refactor (panel registry + modular UI):
- 1–2 weeks depending on how much UI is touched
- pays down complexity and enables real plugins

High refactor (full framework migration):
- 2–6+ weeks
- best long-term, but not necessary to start selling

