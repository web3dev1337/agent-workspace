const {
  getLifecyclePolicy,
  parseWorktreeKey,
  parseTerminalIdentity,
  terminalMatchesWorktree,
  shouldCloseSessionsForThreadAction
} = require('../../server/lifecyclePolicyService');

describe('lifecyclePolicyService', () => {
  test('getLifecyclePolicy returns expected action matrix', () => {
    const policy = getLifecyclePolicy();
    expect(policy?.actions?.removeWorktreeFromWorkspace?.closesSessions).toBe(true);
    expect(policy?.actions?.removeWorktreeFromWorkspace?.preservesFilesOnDisk).toBe(true);
    expect(policy?.actions?.closeThread?.marksThreadStatus).toBe('closed');
    expect(policy?.actions?.archiveThread?.marksThreadStatus).toBe('archived');
  });

  test('parseWorktreeKey parses repository-prefixed worktree ids', () => {
    const parsed = parseWorktreeKey('zoo-game-work6');
    expect(parsed.repositoryName).toBe('zoo-game');
    expect(parsed.worktreeId).toBe('work6');
    expect(parsed.key).toBe('zoo-game-work6');
  });

  test('parseTerminalIdentity extracts repo/worktree metadata', () => {
    const identity = parseTerminalIdentity({
      id: 'zoo-game-work6-claude',
      repository: { name: 'zoo-game' },
      worktree: 'work6'
    });
    expect(identity.repositoryName).toBe('zoo-game');
    expect(identity.worktreeId).toBe('work6');
    expect(identity.composedKey).toBe('zoo-game-work6');
  });

  test('terminalMatchesWorktree avoids false positives like work1 vs work10', () => {
    const parsed = parseWorktreeKey('zoo-game-work1');
    const work1Terminal = {
      id: 'zoo-game-work1-claude',
      repository: { name: 'zoo-game' },
      worktree: 'work1'
    };
    const work10Terminal = {
      id: 'zoo-game-work10-claude',
      repository: { name: 'zoo-game' },
      worktree: 'work10'
    };
    expect(terminalMatchesWorktree(work1Terminal, parsed)).toBe(true);
    expect(terminalMatchesWorktree(work10Terminal, parsed)).toBe(false);
  });

  test('thread action close-session defaults can be overridden', () => {
    expect(shouldCloseSessionsForThreadAction('close', undefined)).toBe(false);
    expect(shouldCloseSessionsForThreadAction('archive', undefined)).toBe(false);
    expect(shouldCloseSessionsForThreadAction('close', true)).toBe(true);
    expect(shouldCloseSessionsForThreadAction('archive', true)).toBe(true);
  });
});
