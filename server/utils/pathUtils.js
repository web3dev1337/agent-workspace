const path = require('path');
const os = require('os');

/**
 * Root directory for Agent Workspace data (workspaces, configs, etc.).
 * Configurable via AGENT_WORKSPACE_DIR env var; defaults to ~/.agent-workspace
 */
function getAgentWorkspaceDir() {
  const envPath = String(process.env.AGENT_WORKSPACE_DIR || '').trim();
  if (envPath) return path.resolve(envPath);
  return path.join(os.homedir(), '.agent-workspace');
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
  const newDir = getAgentWorkspaceDir();
  const oldDir = path.join(os.homedir(), '.orchestrator');

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
  const fs = require('fs');
  try {
    return fs.readdirSync(dirPath).some((entry) => !String(entry || '').startsWith('.'));
  } catch {
    return false;
  }
}

/**
 * Preserve existing ~/GitHub installs unless the new projects root is already populated
 * or the user explicitly chose AGENT_WORKSPACE_PROJECTS_DIR.
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

  process.env.AGENT_WORKSPACE_PROJECTS_DIR = legacyDir;
  return {
    usingLegacyProjectsRoot: true,
    projectsDir: legacyDir,
    legacyDir
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
  getProjectsRoot,
  getLegacyProjectsRoot,
  migrateFromOrchestratorDir,
  bootstrapProjectsRoot,
  resolveRepoConfigPath,
  REPO_CONFIG_NAME,
  LEGACY_REPO_CONFIG_NAME
};
