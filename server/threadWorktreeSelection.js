const fs = require('fs');
const path = require('path');

function normalizeRepositoryPath(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '');
}

function normalizeRepositoryRootForWorktrees(value) {
  const normalized = normalizeRepositoryPath(value);
  if (!normalized) return '';

  const base = path.basename(normalized).toLowerCase();
  if (base === 'master') {
    return normalizeRepositoryPath(path.dirname(normalized));
  }

  if (/^work\d+$/.test(base)) {
    const parent = normalizeRepositoryPath(path.dirname(normalized));
    if (parent && fs.existsSync(path.join(parent, 'master'))) {
      return parent;
    }
  }

  return normalized;
}

function normalizeThreadWorktreeId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const direct = raw.match(/^work(\d+)$/);
  if (direct) return `work${Number(direct[1])}`;
  const digits = raw.match(/(\d+)/);
  if (digits) return `work${Number(digits[1])}`;
  return '';
}

function compareWorktreeIds(a, b) {
  const an = Number(String(a || '').replace(/^work/i, ''));
  const bn = Number(String(b || '').replace(/^work/i, ''));
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a || '').localeCompare(String(b || ''));
}

function repositoryMatches({ targetPath, targetName }, { candidatePath, candidateName }) {
  const cPath = normalizeRepositoryRootForWorktrees(candidatePath);
  const cName = String(candidateName || '').trim().toLowerCase();
  if (targetPath && cPath) return targetPath === cPath;
  if (targetName && cName) return targetName === cName;
  if (targetPath || targetName) return false;
  return true;
}

function collectRepositoryWorktreeIds(workspace, { repositoryPath, repositoryName } = {}) {
  const targetPath = normalizeRepositoryRootForWorktrees(repositoryPath);
  const targetName = String(repositoryName || '').trim().toLowerCase();
  const out = new Set();
  const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];

  for (const terminal of terminals) {
    if (!repositoryMatches({ targetPath, targetName }, {
      candidatePath: terminal?.repository?.path,
      candidateName: terminal?.repository?.name
    })) {
      continue;
    }

    const id = normalizeThreadWorktreeId(terminal?.worktree || terminal?.worktreeId || terminal?.id || '');
    if (!id) continue;
    out.add(id);
  }

  return Array.from(out).sort(compareWorktreeIds);
}

function collectActiveThreadWorktreeIds(threadRows, { repositoryPath, repositoryName } = {}) {
  const targetPath = normalizeRepositoryRootForWorktrees(repositoryPath);
  const targetName = String(repositoryName || '').trim().toLowerCase();
  const out = new Set();

  for (const thread of Array.isArray(threadRows) ? threadRows : []) {
    if (!repositoryMatches({ targetPath, targetName }, {
      candidatePath: thread?.repositoryPath,
      candidateName: thread?.repositoryName
    })) {
      continue;
    }
    const worktreeId = normalizeThreadWorktreeId(thread?.worktreeId || '');
    if (worktreeId) out.add(worktreeId);
  }

  return out;
}

function indexLiveAgentSessions(sessionRows, { repositoryPath, repositoryName } = {}) {
  const targetPath = normalizeRepositoryRootForWorktrees(repositoryPath);
  const targetName = String(repositoryName || '').trim().toLowerCase();
  const live = new Set();

  for (const row of Array.isArray(sessionRows) ? sessionRows : []) {
    const session = Array.isArray(row) ? row[1] : row;
    if (!session) continue;

    const type = String(session?.type || '').trim().toLowerCase();
    if (type !== 'claude' && type !== 'codex') continue;

    const status = String(session?.status || '').trim().toLowerCase();
    if (status === 'dead' || status === 'exited') continue;

    const sessionPathRaw = session?.repositoryPath
      || session?.repositoryRoot
      || session?.config?.repositoryPath
      || session?.config?.cwd
      || '';

    if (!repositoryMatches({ targetPath, targetName }, {
      candidatePath: sessionPathRaw,
      candidateName: session?.repositoryName
    })) {
      continue;
    }

    const worktreeId = normalizeThreadWorktreeId(session?.worktreeId || session?.id || '');
    if (!worktreeId) continue;
    live.add(worktreeId);
  }

  return live;
}

function pickReusableWorktreeId({ workspace, repositoryPath, repositoryName, threadRows, sessionRows } = {}) {
  const candidates = collectRepositoryWorktreeIds(workspace, { repositoryPath, repositoryName });
  if (!candidates.length) return '';

  const active = collectActiveThreadWorktreeIds(threadRows, { repositoryPath, repositoryName });
  const available = candidates.filter((id) => !active.has(id));
  if (!available.length) return '';

  const liveAgent = indexLiveAgentSessions(sessionRows, { repositoryPath, repositoryName });
  const withLiveAgent = available.filter((id) => liveAgent.has(id));
  if (withLiveAgent.length) return withLiveAgent[0];

  return available[0];
}

module.exports = {
  normalizeRepositoryPath,
  normalizeRepositoryRootForWorktrees,
  normalizeThreadWorktreeId,
  collectRepositoryWorktreeIds,
  collectActiveThreadWorktreeIds,
  pickReusableWorktreeId
};
