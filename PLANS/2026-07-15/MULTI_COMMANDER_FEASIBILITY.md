# Multi-Commander Feasibility (2026-07-15)

Ask: "sometimes I just need another commander."

## Current seams (why it's not a small change)

`server/commanderService.js` is a hard singleton around ONE PTY:
- `this.session` (single PTY), `this.isReady`, `this.claudeStarted`, `this.claudeLaunchState` (launch buffering/queue), `this.outputBuffer` (single history) — all singular state.
- Data dir: one `ORCHESTRATOR_DATA_DIR/commander` cwd with one CLAUDE.md.
- Routes are unparameterized: `/api/commander/{status,start,stop,restart,input,start-claude,execute,execute-text,capabilities,sessions}` all reach the same instance.
- Socket events (`commander-output` etc.) carry no instance id.
- `client/commander-panel.js` is a single class instance with fixed DOM ids (`#commander-panel`, `#commander-terminal`, `#commander-*` buttons), one xterm, one `inputChain`.

## Recommended path (follow-up PR)

1. Extract per-instance state into `CommanderInstance` (pty/ready/launch-state/buffer/cwd); `CommanderService` becomes a `Map<id, CommanderInstance>` with `'main'` as the default.
2. Routes gain an optional `:id` (default `main`) — fully backwards compatible: `/api/commander/:id?/input`. Socket events carry `{ commanderId }`.
3. Client: parameterize DOM ids (`commander-panel-<id>`), render a small instance switcher (+ button) in the titlebar; each instance gets its own xterm + input chain. Second instance cwd: `commander/<id>/` so each can have its own CLAUDE.md persona.
4. Keep Commander CLAUDE.md shared by default with optional per-instance override.

Estimated diff: ~400-600 lines across commanderService/index routes/commander-panel + tests. No data-model changes.

## Interim workarounds (available today)

- Any worktree agent terminal can act as a second orchestrating agent — paste the Commander docs path into its prompt (`docs/COMMANDER_CLAUDE.md`) and it has the same API powers (the API is open locally).
- The command palette (Ctrl/Cmd+K) + the new `commander.tools` plugin slot cover many "just run a thing" cases without occupying the Commander.
