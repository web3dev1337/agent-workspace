/**
 * Commander Session Registry
 *
 * Every Commander instance (main, cmd-2, cmd-3...) launches Claude from the
 * SAME cwd (COMMANDER_CWD) by design — Commander needs the orchestrator's own
 * CLAUDE.md/repo context regardless of which tab it is. That breaks Claude
 * Code's own "resume the most recent conversation in this directory" logic
 * (bare --continue/--resume): every instance's plain resume converges on
 * whichever conversation was touched most recently, dragging every OTHER
 * instance's tab along with it. Worktree terminals never hit this because
 * each worktree has its own distinct cwd, so "most recent in this folder" is
 * unambiguous there — Commander's shared cwd is the one place it isn't.
 *
 * Fix: track the exact session UUID each instance is using and pass it
 * explicitly (--session-id on a fresh launch, --resume <uuid> on continue/
 * resume) so each tab always reattaches to its own conversation, never
 * "whichever one is newest right now".
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const REGISTRY_PATH = path.join(getAgentWorkspaceDir(), 'commander-sessions.json');

// Same sanitization Claude Code itself uses for ~/.claude/projects/<folder>,
// mirrored from sessionRecoveryService.claudeProjectFolderName so both stay
// in sync: every character outside [a-zA-Z0-9-] becomes '-'.
function claudeProjectFolderName(targetPath) {
  return String(targetPath || '').replace(/[^a-zA-Z0-9-]/g, '-');
}

function readRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry) {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  } catch {
    // Best-effort — a failed write just means the next launch falls back to
    // Claude's own bare --continue/--resume, no worse than before this existed.
  }
}

// A stored id is only trustworthy if its conversation file still exists and
// has content — Claude Code can prune/rotate session files independently.
function isSessionFileValid(cwd, sessionId) {
  if (!sessionId) return false;
  try {
    const folder = claudeProjectFolderName(cwd);
    const filePath = path.join(require('os').homedir(), '.claude', 'projects', folder, `${sessionId}.jsonl`);
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

/** The session id this Commander instance last used, if its file still exists. */
function getSessionId(instanceId, cwd) {
  const registry = readRegistry();
  const stored = registry[instanceId];
  return isSessionFileValid(cwd, stored) ? stored : null;
}

function setSessionId(instanceId, sessionId) {
  const registry = readRegistry();
  registry[instanceId] = sessionId;
  writeRegistry(registry);
}

/** Best-effort capture after a bare --continue/--resume: whichever session
 * file is newest right now becomes this instance's tracked id going forward,
 * so the NEXT launch is precise even though this one wasn't. */
function captureLatestSessionId(instanceId, cwd) {
  try {
    const folder = claudeProjectFolderName(cwd);
    const dir = path.join(require('os').homedir(), '.claude', 'projects', folder);
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(dir, f);
        const stats = fs.statSync(full);
        return { id: f.replace(/\.jsonl$/, ''), mtime: stats.mtimeMs, size: stats.size };
      })
      .filter((f) => f.size > 0)
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length) setSessionId(instanceId, files[0].id);
  } catch {
    // best-effort
  }
}

function newSessionId() {
  return crypto.randomUUID();
}

module.exports = {
  getSessionId,
  setSessionId,
  captureLatestSessionId,
  newSessionId
};
