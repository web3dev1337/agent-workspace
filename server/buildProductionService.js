const path = require('path');

function resolveBuildProductionContext({ sessionManager, sessionId, worktreeNum }) {
  if (!sessionManager || !sessionManager.sessions) {
    throw new Error('Missing sessionManager');
  }

  const sid = String(sessionId || '').trim();
  if (!sid) {
    throw new Error('Missing sessionId');
  }

  const session = sessionManager.sessions.get(sid);
  const worktreePath = session?.config?.cwd || null;
  if (!worktreePath) {
    const wt = worktreeNum != null ? ` (worktreeNum=${worktreeNum})` : '';
    throw new Error(`No cwd found for session ${sid}${wt}`);
  }

  return {
    worktreePath,
    scriptPath: path.join(worktreePath, 'build-production-with-console.sh')
  };
}

module.exports = {
  resolveBuildProductionContext
};

