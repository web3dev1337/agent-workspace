const THREAD_ACTION_DEFAULTS = Object.freeze({
  close: false,
  archive: false
});

const LIFECYCLE_POLICY = Object.freeze({
  actions: {
    closeTerminalProcess: {
      closesSessions: true,
      clearsRecovery: true,
      removesWorktreeFromWorkspace: false,
      closesLinkedThreads: false,
      preservesFilesOnDisk: true
    },
    removeWorktreeFromWorkspace: {
      closesSessions: true,
      clearsRecovery: true,
      removesWorktreeFromWorkspace: true,
      closesLinkedThreads: true,
      preservesFilesOnDisk: true
    },
    closeThread: {
      defaultClosesSessions: THREAD_ACTION_DEFAULTS.close,
      marksThreadStatus: 'closed',
      preservesWorktree: true
    },
    archiveThread: {
      defaultClosesSessions: THREAD_ACTION_DEFAULTS.archive,
      marksThreadStatus: 'archived',
      preservesWorktree: true
    }
  }
});

function normalizeToken(raw) {
  return String(raw || '').trim().toLowerCase();
}

function stripSessionTypeSuffix(value) {
  return normalizeToken(value).replace(/-(claude|codex|server)$/i, '');
}

function normalizeWorktreeToken(raw) {
  const value = normalizeToken(raw);
  if (!value) return '';
  const noSuffix = stripSessionTypeSuffix(value);
  const pathParts = noSuffix.split(/[\\/]+/).filter(Boolean);
  const tail = pathParts[pathParts.length - 1] || noSuffix;
  return tail;
}

function parseWorktreeKey(raw) {
  const keyRaw = String(raw || '').trim();
  const key = stripSessionTypeSuffix(keyRaw);
  if (!key) {
    return { raw: '', key: '', repositoryName: '', worktreeId: '' };
  }

  const slashParts = key.split('/').filter(Boolean);
  if (slashParts.length > 1) {
    const worktreeId = normalizeWorktreeToken(slashParts[slashParts.length - 1]);
    const repositoryName = normalizeToken(slashParts.slice(0, -1).join('/'));
    return {
      raw: keyRaw,
      key,
      repositoryName,
      worktreeId
    };
  }

  const match = key.match(/^(.*)-(work\d+|main|master)$/i);
  if (match && match[1]) {
    return {
      raw: keyRaw,
      key,
      repositoryName: normalizeToken(match[1]),
      worktreeId: normalizeToken(match[2])
    };
  }

  return {
    raw: keyRaw,
    key,
    repositoryName: '',
    worktreeId: normalizeWorktreeToken(key)
  };
}

function parseTerminalIdentity(terminal) {
  const repositoryName = normalizeToken(terminal?.repository?.name);
  const terminalId = normalizeToken(terminal?.id);
  const terminalKey = stripSessionTypeSuffix(terminalId);
  const worktreeId = (
    normalizeWorktreeToken(terminal?.worktree)
    || normalizeWorktreeToken(terminal?.worktreeId)
    || normalizeWorktreeToken(terminal?.worktreePath)
    || (() => {
      if (!terminalKey) return '';
      if (repositoryName && terminalKey.startsWith(`${repositoryName}-`)) {
        return normalizeWorktreeToken(terminalKey.slice(repositoryName.length + 1));
      }
      const tokens = terminalKey.split('-').filter(Boolean);
      return normalizeWorktreeToken(tokens[tokens.length - 1] || '');
    })()
  );
  const composedKey = repositoryName && worktreeId ? `${repositoryName}-${worktreeId}` : '';

  return {
    repositoryName,
    worktreeId,
    terminalId,
    terminalKey,
    composedKey
  };
}

function terminalMatchesWorktree(terminal, parsedWorktree) {
  const parsed = parsedWorktree && typeof parsedWorktree === 'object'
    ? parsedWorktree
    : parseWorktreeKey(parsedWorktree);
  const targetKey = normalizeToken(parsed?.key);
  const targetRepo = normalizeToken(parsed?.repositoryName);
  const targetWorktree = normalizeToken(parsed?.worktreeId);
  if (!targetKey && !targetWorktree) return false;

  const identity = parseTerminalIdentity(terminal);
  if (identity.composedKey && targetKey && identity.composedKey === targetKey) return true;
  if (targetRepo && targetWorktree) {
    return identity.repositoryName === targetRepo && identity.worktreeId === targetWorktree;
  }
  if (targetWorktree && identity.worktreeId === targetWorktree) return true;
  if (targetKey && identity.terminalId === targetKey) return true;
  if (targetKey && identity.terminalKey === targetKey) return true;
  return false;
}

function shouldCloseSessionsForThreadAction(action, requested) {
  if (typeof requested === 'boolean') return requested;
  const normalizedAction = normalizeToken(action);
  if (normalizedAction === 'close') return THREAD_ACTION_DEFAULTS.close;
  if (normalizedAction === 'archive') return THREAD_ACTION_DEFAULTS.archive;
  return false;
}

function getLifecyclePolicy() {
  return LIFECYCLE_POLICY;
}

module.exports = {
  getLifecyclePolicy,
  parseWorktreeKey,
  parseTerminalIdentity,
  terminalMatchesWorktree,
  shouldCloseSessionsForThreadAction
};
