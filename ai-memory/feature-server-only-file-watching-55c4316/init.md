# Feature: Server-Only File Watching Setting

## User Request
Add a new user setting `serverOnlyFileWatching` (boolean, default: false) that controls whether nodemon watches only server files, so client-only changes via git pull don't restart the server.

## Requirements
1. New user setting in `user-settings.json` and defaults
2. Launcher script `scripts/dev-server.js` that reads the setting and spawns nodemon accordingly
3. Settings UI toggle in the client settings panel
4. Follows existing patterns for server-persisted settings
