# AnrokX Open PR Review — 2026-03-06

## Open PRs

| PR | Title | Size | Branch |
|----|-------|------|--------|
| **#796** | fix: clean windows onboarding changes against main | +6382/-2785, 12 files | `fix/windows-onboarding-clean-main` |
| **#791** | fix(windows): prevent updater plugin startup panic | +5/-0, 1 file | `fix/windows-updater-plugin-config-startup` |
| **#790** | test: fix windows CI recovery cleanup tests | +10/-10, 2 files | `fix/windows-build-verification` |
| **#788** | feat: add serverOnlyFileWatching user setting | +115/-1, 9 files | `feature/server-only-file-watching` |

## Recently Merged (last 48hrs)

| PR | Title | Merged | Size |
|----|-------|--------|------|
| #794 | feat: polish windows onboarding UX and setup detection | Mar 4 | +3245/-476, 9 files |
| #793 | feat(onboarding): guide dependency setup step-by-step | Mar 3 | +303/-62, 4 files |

---

## PR #796 — Windows Onboarding Wizard (main review)

Full first-run dependency wizard for Windows users. Checks for Git, Node, npm, GitHub CLI, Claude Code, and Codex CLI, then guides install via winget/PowerShell.

### Medium Issues

1. **Dead code: `guidance` variable** (client/app.js) — ~60 lines computing a variable that is never rendered in the template. Remove or wire it up.

2. **Memory leak in `setupActionRuns`** (server/setupActionService.js) — `setupActionRuns` and `latestRunByActionId` Maps grow unboundedly with no cleanup/TTL. Add pruning.

3. **Empty updater `pubkey`** (src-tauri/tauri.conf.json) — `pubkey: ""` prevents the startup panic but could silently accept unsigned updates. Set a real key or remove updater config entirely.

4. **Duplicated Windows tool path logic** — Both `diagnosticsService.js` and `setupActionService.js` independently resolve Windows tool paths (~50 lines each). Extract a shared module to prevent divergence.

5. **`autoCreate: true` behavioral change** (server/workspaceManager.js) — Changed from `false` to `true`. Existing users will see worktrees auto-created on new workspaces. Should be documented in PR description.

6. **`stdout`/`stderr` nulled for ALL platforms** (src-tauri/src/main.rs) — Backend crash output is lost on all platforms, not just Windows. Consider routing to a log file.

### Low Issues

7. **Unescaped `statusText`/`runLabel`/`nextLabel`** in HTML template — Currently safe (hardcoded values) but violates defense-in-depth. Wrap in `escapeHtml()`.

8. **`configureGitIdentity` platform-locked to win32** — `git config --global` works everywhere. The guard is unnecessary.

9. **1,400-line method** (`setupDependencySetupWizard`) — Should be extracted to its own file (e.g. `client/dependency-wizard.js`).

10. **Inline `require('child_process')`** inside route handler in server/index.js — Minor style inconsistency, already required elsewhere.

### What's Good

- Security is solid: URL validation on `open-url` endpoint, `escapeHtml()` used consistently, command injection surface is closed (hardcoded action IDs only)
- Workspace startup race condition fixed properly with `workspaceSystemReady` promise gate
- Toast notification system rewrite is a clean improvement over the old inline-style approach
- Scrollbar theming well-implemented with `@supports` fallback for `color-mix()`
- ARIA attributes on the onboarding modal
- CSS specificity fix in notifications.js scopes generic class names properly

### Architecture Note

`setupActionService.js` does NOT follow the singleton class pattern used by every other service (SessionManager, WorkspaceManager, etc.). Uses module-level Maps with plain exported functions. Works fine but breaks consistency.

---

## PR #791 — Updater Plugin Fix

**5 lines.** Adds `plugins.updater.pubkey: ""` to `tauri.conf.json` to prevent Tauri crash on Windows packaged builds. Correct fix for the immediate panic. Same empty pubkey concern as noted in #796 review.

**Note:** This commit is cherry-picked into #796, so if #796 merges first, #791 can be closed as redundant.

---

## PR #790 — Test Fixes

**+10/-10, 2 files.** Updates stale test expectations:
- `clearAgent` → `markAgentInactive` (matching current behavior)
- Seeds in-memory state directly instead of mocking `loadWorkspaceState`

Clean, correct, minimal. Should merge.

---

## PR #788 — Server-Only File Watching

**+115/-1, 9 files.** Adds `serverOnlyFileWatching` toggle so client-only file changes don't restart nodemon.

- New `scripts/dev-server.js` launcher reads user-settings.json at startup
- Settings UI toggle under new "Developer" section
- Follows existing patterns well
- Includes `ai-memory/` files that should probably be excluded from the PR

Should merge.

---

## Merge Recommendations

| Priority | PR | Action |
|----------|----|--------|
| 1 | **#790** | Merge as-is |
| 2 | **#788** | Merge (optionally remove ai-memory files first) |
| 3 | **#791** | Merge, file follow-up for real pubkey |
| 4 | **#796** | Address medium issues (dead code, memory leak, escape hardening), then merge |
