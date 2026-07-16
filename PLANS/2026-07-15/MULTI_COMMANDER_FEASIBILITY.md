# Multi-Commander Feasibility (2026-07-15)

> **UPDATE 2026-07-16 — SHIPPED.** Multiple commander instances now exist:
> `CommanderManager` keys N instances by id (primary stays `commander`, fully
> backward compatible), id-aware PTY-lifecycle routes, scoped socket payloads,
> `list`/`spawn`/`remove` routes, and a titlebar tab-switcher that rebinds the
> single panel to another backend PTY. Remaining follow-up is only full
> side-by-side N-panel rendering (see end). Original analysis below.

Ask: "sometimes I just need another commander."

## Current seams (why it's not a small change)

`server/commanderService.js` is a hard singleton around ONE PTY:
- `this.session` (single PTY object, hardcoded `id: 'commander'`), `this.isReady`, `this.claudeStarted`, `this.claudeLaunchState` (launch buffering/queue), `this.outputBuffer` (single history) — all singular state.
- `COMMANDER_CWD` is computed **once at module load** from env (`commanderService.js:47-55`) — must move into per-instance constructor options. Data dir: one `ORCHESTRATOR_DATA_DIR/commander` cwd with one CLAUDE.md.
- ~25 REST routes (`server/index.js:7772-8085`: status/start/start-claude/input/resize/stop/restart/output/clear/sessions/send-to-session/execute/execute-text/context/prompt/capabilities…) take zero commander-id parameter — all close over the one boot-time instance.
- Socket broadcasts are global and unscoped: `io.emit('commander-output', {data})` / `commander-exit` carry no instance id — N commanders need `{commanderId}` payloads plus rooms or client-side filtering.
- `CommanderContextService.getInstance()` is also a singleton snapshotting one global UI state.
- `client/commander-panel.js` is instantiated exactly once (`app.js:1187`) with fixed DOM ids (`#commander-panel`, `#commander-terminal`, `#commander-*`), one xterm, one `inputChain`; the cmd-mode localStorage key is global.
- Useful precedent: the Commander panel is deliberately EXCLUDED from the workspace tab-manager's per-tab state swapping — but that swap machinery (terminals/sessions swapped per tab) is a ready-made template for "one commander per workspace tab" instead of a green-field design.

## Recommended path (follow-up PR)

1. Extract per-instance state into `CommanderInstance` (pty/ready/launch-state/buffer/cwd); `CommanderService` becomes a `Map<id, CommanderInstance>` with `'main'` as the default.
2. Routes gain an optional `:id` (default `main`) — fully backwards compatible: `/api/commander/:id?/input`. Socket events carry `{ commanderId }`.
3. Client: parameterize DOM ids (`commander-panel-<id>`), render a small instance switcher (+ button) in the titlebar; each instance gets its own xterm + input chain. Second instance cwd: `commander/<id>/` so each can have its own CLAUDE.md persona.
4. Keep Commander CLAUDE.md shared by default with optional per-instance override.

Estimated diff: ~400-600 lines across commanderService/index routes/commander-panel + tests. No data-model changes.

## Related follow-up: Commander status strip

The biggest unused real estate inside the Commander window is a persistent status strip between the toolbar and the terminal (live session count / queue depth / blocked items / recent advice preview) — `commanderContextService.getSnapshot()` already assembles that data server-side. The new `commander.tools` plugin strip occupies part of that region; a status strip would sit beside/above it.

## `/clear` bug post-mortem (two layers)

1. Pre-PR-#1001 (fixed upstream 2026-07-12): captured slash commands unrecognized by the orchestrator parser were discarded entirely — `/clear` never reached the agent at all.
2. Post-#1001 residual (fixed in this branch): the forward path sent `"/clear\r"` as ONE pty write — agent CLIs treat a multi-char chunk with a trailing `\r` as a bracketed paste (inserted as text, not submitted). Now text and `\r` are separate writes (300ms apart), matching the two-write submit rule used everywhere else. Remaining known gap: commands typed before the Commander agent is ready surface an explicit `[cmd] ✗ … not delivered` line (PR #1008) — easy to scroll past, could become a toast.

## Interim workarounds (available today)

- Any worktree agent terminal can act as a second orchestrating agent — paste the Commander docs path into its prompt (`docs/COMMANDER_CLAUDE.md`) and it has the same API powers (the API is open locally).
- The command palette (Ctrl/Cmd+K) + the new `commander.tools` plugin slot cover many "just run a thing" cases without occupying the Commander.
