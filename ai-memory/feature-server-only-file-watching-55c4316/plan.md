# Implementation Plan

## Files to modify
1. `server/userSettingsService.js` - Add `serverOnlyFileWatching` to `getDefaultSettings()` under `global`
2. `user-settings.default.json` - Add the default setting
3. `scripts/dev-server.js` - New launcher script (reads setting, spawns nodemon)
4. `package.json` - Point `dev:server` at the launcher
5. `client/index.html` - Add toggle to settings panel
6. `client/app.js` - Add event listener + sync for the toggle

## Implementation order
1. Add setting to defaults (server + default JSON)
2. Create launcher script
3. Update package.json
4. Add UI toggle
5. Syntax check + test
6. Commit, push, PR
