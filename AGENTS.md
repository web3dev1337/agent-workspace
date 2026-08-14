# Agent Workspace Repo Instructions

Read `CLAUDE.md` and `CODEBASE_DOCUMENTATION.md` before making changes.

## Release Versioning
- `package.json` is the release version source of truth.
- Keep `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` synced with `npm run release:sync-version`.
- Run `npm run release:check-version` before tagging or shipping a release build.
- Release tags must be `v<package.json version>`.
- `scripts/tauri/run-tauri-build.js` clears stale `bundle/` outputs and verifies that installer filenames include the expected version before CI uploads them.

## In-Place Production Update (deferred restart, live sessions survive until go-live)

To update the running production `master/` checkout without killing active sessions mid-update
(full write-up: `PLANS/2026-08-15/PROD_UPDATE.md`):

1. `pgrep -af nodemon` — find the nodemon pid watching `server/`.
2. `kill -STOP <nodemon pid>` — freezes nodemon. The server keeps running old code from memory; ptys and sessions survive.
3. Update files (`git pull` / `git checkout`). File-change events queue up but do not fire.
4. When ready for downtime: `kill -CONT <nodemon pid>` — queued events fire, nodemon restarts the server, and every active session dies at that chosen moment. Verify with `ss -tlnp | grep :3000` and a `curl` to an API endpoint.

Consequences and rules:
- The `-CONT` restart kills ALL live sessions (Commander included) — pick the moment deliberately.
- Never leave nodemon STOPped across a stack shutdown: pending SIGINT/SIGHUP is not processed and it orphans.
- Client-only changes (`client/*.js`, `client/*.css`) need NO restart — nodemon does not watch them and Express serves them statically. A browser Ctrl+F5 is enough.
