'use strict';

const { isSafeFlag, hasDangerousShell } = require('./utils/shellSafety');

// Resolves the dev-server launch command for a session from the cascaded
// config instead of a hardcoded binary. Config keys (any cascade level:
// Global → Category → Framework → Project → Worktree):
//
//   "serverCommand": "hytopia start {{gameMode}} {{commonFlags}}"
//   "gameModes":   { "deathmatch": { "flag": "--mode=deathmatch", "label": "Deathmatch" } }
//   "commonFlags": { "unlockAll":  { "flag": "--unlock-all", "label": "Unlock All" } }
//
// {{gameMode}} substitutes the selected mode's flag; {{commonFlags}} the
// flags enabled in launchSettings.flags. Templates without placeholders
// just run as-is.

const DEFAULT_COMMANDS_BY_TYPE = {
  'hytopia-game': 'hytopia start {{gameMode}} {{commonFlags}}',
  default: 'npm run dev'
};

const findTerminalForSession = (workspaceManager, sessionId) => {
  try {
    const active = workspaceManager?.getActiveWorkspace?.();
    const workspace = active?.id ? workspaceManager.getWorkspaceById?.(active.id) : null;
    const terminals = workspace?.terminals?.pairs || workspace?.terminals || [];
    if (!Array.isArray(terminals)) return null;

    const sid = String(sessionId || '');
    const worktreeMatch = sid.match(/-(work\d+)-server$/) || sid.match(/-(work\d+)-/);
    const worktreeId = worktreeMatch ? worktreeMatch[1] : null;
    const repoName = worktreeId ? sid.slice(0, sid.indexOf(`-${worktreeId}`)) : null;

    return terminals.find((t) => {
      const tWorktree = t?.worktreeId || t?.worktree || null;
      const tRepo = t?.repository?.name || t?.repositoryName || null;
      if (worktreeId && tWorktree && tWorktree !== worktreeId) return false;
      if (repoName && tRepo && tRepo !== repoName) return false;
      return !!(tWorktree || tRepo);
    }) || null;
  } catch {
    return null;
  }
};

const resolveServerLaunchCommand = async ({
  workspaceManager,
  sessionId,
  cwd,
  environment,
  launchSettings
} = {}) => {
  const terminal = findTerminalForSession(workspaceManager, sessionId);
  const repositoryType = terminal?.repository?.type
    || workspaceManager?.getActiveWorkspace?.()?.type
    || null;

  let cascaded = null;
  try {
    if (repositoryType && typeof workspaceManager?.getCascadedConfigForWorktree === 'function') {
      cascaded = await workspaceManager.getCascadedConfigForWorktree(repositoryType, cwd || null);
    }
  } catch {
    cascaded = null;
  }

  // The command template + all substituted values come from repo/user config
  // (.orchestrator-config.json) and are written to a shell, so a cloned repo
  // could carry a malicious flag. Every config-derived value is validated
  // against a shell-safe allowlist; unsafe values are dropped. If the template
  // itself carries shell metacharacters (beyond its {{...}} placeholders) we
  // fall back to the safe built-in default rather than run it.
  const rawTemplate = String(
    cascaded?.serverCommand
    || DEFAULT_COMMANDS_BY_TYPE[repositoryType]
    || DEFAULT_COMMANDS_BY_TYPE.default
  );
  const templateSansPlaceholders = rawTemplate.replace(/\{\{\s*(gameMode|commonFlags)\s*\}\}/g, '');
  const template = hasDangerousShell(templateSansPlaceholders)
    ? (DEFAULT_COMMANDS_BY_TYPE[repositoryType] || DEFAULT_COMMANDS_BY_TYPE.default)
    : rawTemplate;

  // {{gameMode}}: the selected environment may be a configured game-mode key.
  const gameModes = cascaded?.gameModes && typeof cascaded.gameModes === 'object' ? cascaded.gameModes : {};
  const selectedMode = gameModes[String(environment || '')] || null;
  const rawModeFlag = String(selectedMode?.flag || '').trim();
  const gameModeFlag = isSafeFlag(rawModeFlag) ? rawModeFlag : '';

  // {{commonFlags}}: flags toggled on in launch settings.
  const commonFlags = cascaded?.commonFlags && typeof cascaded.commonFlags === 'object' ? cascaded.commonFlags : {};
  const enabled = launchSettings?.flags && typeof launchSettings.flags === 'object' ? launchSettings.flags : {};
  const commonFlagsStr = Object.entries(commonFlags)
    .filter(([key]) => enabled[key] === true)
    .map(([, def]) => String(def?.flag || '').trim())
    .filter((f) => f && isSafeFlag(f))
    .join(' ');

  let command = template
    .replace(/\{\{\s*gameMode\s*\}\}/g, gameModeFlag)
    .replace(/\{\{\s*commonFlags\s*\}\}/g, commonFlagsStr)
    .replace(/\s{2,}/g, ' ')
    .trim();

  const rawGameArgs = String(launchSettings?.gameArgs || '').trim();
  if (rawGameArgs && isSafeFlag(rawGameArgs)) command += ` ${rawGameArgs}`;

  return {
    command,
    repositoryType,
    usedGameMode: (selectedMode && gameModeFlag) ? String(environment) : null
  };
};

module.exports = { resolveServerLaunchCommand, DEFAULT_COMMANDS_BY_TYPE };
