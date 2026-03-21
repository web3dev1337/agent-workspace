const path = require('path');
const os = require('os');

function getDefaultAgentWorkspaceDir() {
  return path.join(os.homedir(), '.agent-workspace');
}

function getLegacyAgentWorkspaceDir() {
  return path.join(os.homedir(), '.orchestrator');
}

function pathsResolveToSameLocation(a, b) {
  const fs = require('fs');
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

function countVisibleEntries(dirPath) {
  const fs = require('fs');
  try {
    return fs.readdirSync(dirPath).filter((entry) => !String(entry || '').startsWith('.')).length;
  } catch {
    return 0;
  }
}

function getWorkspaceEntryCount(baseDir) {
  return countVisibleEntries(path.join(baseDir, 'workspaces'));
}

function isSameFileContent(sourcePath, targetPath) {
  const fs = require('fs');
  try {
    const sourceStat = fs.statSync(sourcePath);
    const targetStat = fs.statSync(targetPath);
    if (sourceStat.size !== targetStat.size) return false;
    const sourceContent = fs.readFileSync(sourcePath);
    const targetContent = fs.readFileSync(targetPath);
    return sourceContent.equals(targetContent);
  } catch {
    return false;
  }
}

function copyTreeSync(sourcePath, targetPath) {
  const fs = require('fs');
  const stat = fs.lstatSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyTreeSync(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function mergeLegacyDataDir() {
  const fs = require('fs');

  // Skip if env override is set (user chose a custom path)
  if (String(process.env.AGENT_WORKSPACE_DIR || '').trim()) {
    return { merged: false, reason: 'env-override' };
  }

  const state = getLegacyCompatibilityState();
  if (!state.shouldUseLegacyDir) {
    return {
      merged: false,
      reason: state.reason,
      sourceDir: state.oldDir,
      targetDir: state.newDir
    };
  }

  const sourceDir = state.oldDir;
  const targetDir = state.newDir;
  const backupRoot = path.join(
    targetDir,
    'migration-backups',
    `from-orchestrator-${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  const report = {
    merged: false,
    reason: state.reason,
    sourceDir,
    targetDir,
    backupDir: backupRoot,
    copied: [],
    overwritten: []
  };

  if (!fs.existsSync(sourceDir)) {
    return { ...report, merged: false, reason: 'legacy-missing' };
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const mergeEntry = (srcPath, dstPath, relPath = '') => {
    const srcStat = fs.lstatSync(srcPath);
    const dstExists = fs.existsSync(dstPath);

    if (srcStat.isDirectory()) {
      if (!dstExists) {
        copyTreeSync(srcPath, dstPath);
        report.copied.push(relPath || path.basename(srcPath));
        return;
      }

      const dstStat = fs.lstatSync(dstPath);
      if (!dstStat.isDirectory()) {
        const backupPath = path.join(backupRoot, relPath);
        copyTreeSync(dstPath, backupPath);
        report.overwritten.push(relPath);
        fs.rmSync(dstPath, { recursive: true, force: true });
        copyTreeSync(srcPath, dstPath);
        return;
      }

      for (const entry of fs.readdirSync(srcPath)) {
        const nextRel = relPath ? path.join(relPath, entry) : entry;
        mergeEntry(path.join(srcPath, entry), path.join(dstPath, entry), nextRel);
      }
      return;
    }

    if (!dstExists) {
      copyTreeSync(srcPath, dstPath);
      report.copied.push(relPath || path.basename(srcPath));
      return;
    }

    const dstStat = fs.lstatSync(dstPath);
    if (dstStat.isDirectory() || !isSameFileContent(srcPath, dstPath)) {
      const backupPath = path.join(backupRoot, relPath);
      copyTreeSync(dstPath, backupPath);
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      report.overwritten.push(relPath || path.basename(srcPath));
    }
  };

  for (const entry of fs.readdirSync(sourceDir)) {
    if (entry === 'migration-backups') continue;
    mergeEntry(path.join(sourceDir, entry), path.join(targetDir, entry), entry);
  }

  report.merged = report.copied.length > 0 || report.overwritten.length > 0;
  return report;
}

function getLegacyCompatibilityState() {
  const fs = require('fs');
  const newDir = getDefaultAgentWorkspaceDir();
  const oldDir = getLegacyAgentWorkspaceDir();

  if (!fs.existsSync(oldDir)) {
    return {
      shouldUseLegacyDir: false,
      newDir,
      oldDir,
      reason: 'legacy-missing'
    };
  }

  if (pathsResolveToSameLocation(newDir, oldDir)) {
    return {
      shouldUseLegacyDir: false,
      newDir,
      oldDir,
      reason: 'already-linked'
    };
  }

  if (!fs.existsSync(newDir)) {
    return {
      shouldUseLegacyDir: false,
      newDir,
      oldDir,
      reason: 'new-missing'
    };
  }

  const oldWorkspaceCount = getWorkspaceEntryCount(oldDir);
  const newWorkspaceCount = getWorkspaceEntryCount(newDir);
  const oldRootCount = countVisibleEntries(oldDir);
  const newRootCount = countVisibleEntries(newDir);
  const oldHasUserData = oldWorkspaceCount > 0 || oldRootCount > 0;
  const newHasUserData = newWorkspaceCount > 0 || newRootCount > 0;

  if (!oldHasUserData) {
    return {
      shouldUseLegacyDir: false,
      newDir,
      oldDir,
      reason: 'legacy-empty',
      oldWorkspaceCount,
      newWorkspaceCount,
      oldRootCount,
      newRootCount
    };
  }

  if (!newHasUserData) {
    return {
      shouldUseLegacyDir: true,
      newDir,
      oldDir,
      reason: 'new-empty',
      oldWorkspaceCount,
      newWorkspaceCount,
      oldRootCount,
      newRootCount
    };
  }

  if (oldWorkspaceCount > newWorkspaceCount) {
    return {
      shouldUseLegacyDir: true,
      newDir,
      oldDir,
      reason: 'legacy-has-more-workspaces',
      oldWorkspaceCount,
      newWorkspaceCount,
      oldRootCount,
      newRootCount
    };
  }

  if (oldWorkspaceCount === newWorkspaceCount && oldRootCount > newRootCount) {
    return {
      shouldUseLegacyDir: true,
      newDir,
      oldDir,
      reason: 'legacy-has-more-state',
      oldWorkspaceCount,
      newWorkspaceCount,
      oldRootCount,
      newRootCount
    };
  }

  return {
    shouldUseLegacyDir: false,
    newDir,
    oldDir,
    reason: 'prefer-new',
    oldWorkspaceCount,
    newWorkspaceCount,
    oldRootCount,
    newRootCount
  };
}

/**
 * Root directory for Agent Workspace data (workspaces, configs, etc.).
 * Configurable via AGENT_WORKSPACE_DIR env var; defaults to ~/.agent-workspace
 */
function getAgentWorkspaceDir() {
  const envPath = String(process.env.AGENT_WORKSPACE_DIR || '').trim();
  if (envPath) return path.resolve(envPath);
  const compatibility = getLegacyCompatibilityState();
  if (compatibility.shouldUseLegacyDir) {
    return compatibility.oldDir;
  }
  return compatibility.newDir;
}

/**
 * Root directory where managed project repos are cloned.
 * Each project lives in its own subdirectory with the master/ worktree convention.
 * Configurable via AGENT_WORKSPACE_PROJECTS_DIR env var; defaults to ~/.agent-workspace/projects
 */
function getProjectsRoot() {
  const envPath = String(process.env.AGENT_WORKSPACE_PROJECTS_DIR || '').trim();
  if (envPath) return path.resolve(envPath);
  return path.join(getAgentWorkspaceDir(), 'projects');
}

function getLegacyProjectsRoot() {
  return path.join(os.homedir(), 'GitHub');
}

/**
 * Migrate ~/.orchestrator to ~/.agent-workspace if the old directory exists
 * and the new one doesn't. Safe to call multiple times (idempotent).
 * Returns true if migration was performed.
 */
function migrateFromOrchestratorDir() {
  const fs = require('fs');
  const newDir = getDefaultAgentWorkspaceDir();
  const oldDir = getLegacyAgentWorkspaceDir();

  // Skip if env override is set (user chose a custom path)
  if (String(process.env.AGENT_WORKSPACE_DIR || '').trim()) return false;

  // Skip if new dir already exists or old dir doesn't exist
  if (fs.existsSync(newDir)) return false;
  if (!fs.existsSync(oldDir)) return false;

  try {
    fs.renameSync(oldDir, newDir);
    // Leave a symlink at the old path for any external tools that reference it
    try {
      fs.symlinkSync(newDir, oldDir);
    } catch {
      // Symlink creation may fail on some systems; non-critical
    }
    return true;
  } catch {
    // rename can fail across filesystems; fall back to just using old dir
    // by setting the env var for this process
    process.env.AGENT_WORKSPACE_DIR = oldDir;
    return false;
  }
}

function hasVisibleEntries(dirPath) {
  return countVisibleEntries(dirPath) > 0;
}

/**
 * Check whether a directory looks like a repo using the worktree layout
 * (has a master/ or main/ subdirectory containing a .git file or folder).
 */
function hasWorktreeLayout(dirPath) {
  const fs = require('fs');
  for (const name of ['master', 'main']) {
    const candidate = path.join(dirPath, name);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) continue;
      const gitPath = path.join(candidate, '.git');
      fs.statSync(gitPath);
      return true;
    } catch {
      // not found, try next
    }
  }
  return false;
}

function isGitRepo(dirPath) {
  const fs = require('fs');
  try {
    fs.statSync(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

const MAX_SCAN_DEPTH = 8;

/**
 * Recursively scan a directory tree to count repos and how many use
 * worktree layout. Stops recursing into directories that are repos
 * (so it never crawls node_modules, .git internals, etc.).
 * Depth-limited to MAX_SCAN_DEPTH as a safety net.
 * Returns { total, worktree } counts.
 */
function countWorktreeLayoutRepos(dirPath) {
  const fs = require('fs');
  let total = 0;
  let worktree = 0;

  function scan(dir, depth) {
    if (depth > MAX_SCAN_DEPTH) return;

    let entries;
    try {
      entries = fs.readdirSync(dir).filter((e) => !String(e || '').startsWith('.'));
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      try {
        if (!fs.statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }

      if (hasWorktreeLayout(entryPath)) {
        total++;
        worktree++;
      } else if (isGitRepo(entryPath)) {
        total++;
      } else {
        scan(entryPath, depth + 1);
      }
    }
  }

  scan(dirPath, 0);
  return { total, worktree };
}

/**
 * Preserve existing ~/GitHub installs only when a meaningful portion of its
 * repos use the worktree layout (master/ or main/ subdirectory with .git).
 * If the legacy dir is mostly flat clones, skip grandfathering so new repos
 * get created under ~/.agent-workspace/projects/ with proper layout.
 *
 * Configurable via AGENT_WORKSPACE_PROJECTS_DIR env var (explicit override).
 */
function bootstrapProjectsRoot() {
  const fs = require('fs');
  const envPath = String(process.env.AGENT_WORKSPACE_PROJECTS_DIR || '').trim();
  const projectsDir = getProjectsRoot();
  const legacyDir = getLegacyProjectsRoot();

  if (envPath) {
    return { usingLegacyProjectsRoot: false, projectsDir };
  }

  if (!fs.existsSync(legacyDir) || !hasVisibleEntries(legacyDir)) {
    return { usingLegacyProjectsRoot: false, projectsDir };
  }

  if (fs.existsSync(projectsDir) && hasVisibleEntries(projectsDir)) {
    return { usingLegacyProjectsRoot: false, projectsDir };
  }

  // Check if the legacy dir actually uses worktree layout
  const { total, worktree } = countWorktreeLayoutRepos(legacyDir);
  if (total > 0 && worktree === 0) {
    // All flat clones, no worktree layout at all — don't grandfather
    return { usingLegacyProjectsRoot: false, projectsDir, legacySkipReason: 'no-worktree-layout', total, worktree };
  }
  if (total >= 4 && worktree / total < 0.25) {
    // Very few repos use worktree layout — don't grandfather
    return { usingLegacyProjectsRoot: false, projectsDir, legacySkipReason: 'insufficient-worktree-layout', total, worktree };
  }

  process.env.AGENT_WORKSPACE_PROJECTS_DIR = legacyDir;
  return {
    usingLegacyProjectsRoot: true,
    projectsDir: legacyDir,
    legacyDir,
    total,
    worktree
  };
}

/**
 * Per-repo config filename. Prefers .agent-workspace-config.json,
 * falls back to legacy .orchestrator-config.json if it exists.
 */
const REPO_CONFIG_NAME = '.agent-workspace-config.json';
const LEGACY_REPO_CONFIG_NAME = '.orchestrator-config.json';

function resolveRepoConfigPath(dirPath) {
  const fs = require('fs');
  const primary = path.join(dirPath, REPO_CONFIG_NAME);
  if (fs.existsSync(primary)) return primary;
  const legacy = path.join(dirPath, LEGACY_REPO_CONFIG_NAME);
  if (fs.existsSync(legacy)) return legacy;
  return primary; // default to new name for creation
}

function normalizePathSlashes(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function splitPathSegments(value) {
  return normalizePathSlashes(value).split('/').filter(Boolean);
}

function getPathBasename(value) {
  const trimmed = normalizePathSlashes(value).replace(/\/+$/, '');
  if (!trimmed) return '';
  return path.basename(trimmed);
}

function getTrailingPathLabel(value, count = 2) {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 2;
  return splitPathSegments(value).slice(-safeCount).join('/');
}

module.exports = {
  normalizePathSlashes,
  splitPathSegments,
  getPathBasename,
  getTrailingPathLabel,
  getAgentWorkspaceDir,
  getDefaultAgentWorkspaceDir,
  getLegacyAgentWorkspaceDir,
  getLegacyCompatibilityState,
  mergeLegacyDataDir,
  getProjectsRoot,
  getLegacyProjectsRoot,
  migrateFromOrchestratorDir,
  bootstrapProjectsRoot,
  hasWorktreeLayout,
  countWorktreeLayoutRepos,
  resolveRepoConfigPath,
  REPO_CONFIG_NAME,
  LEGACY_REPO_CONFIG_NAME
};
