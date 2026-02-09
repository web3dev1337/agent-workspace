const {
  getLifecyclePolicy,
  parseWorktreeKey,
  parseTerminalIdentity,
  terminalMatchesWorktree,
  sessionRecordMatchesWorktree,
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

  test('parseWorktreeKey supports slash-form repository/worktree keys', () => {
    const parsed = parseWorktreeKey('hytopia/zoo-game/work3');
    expect(parsed.repositoryName).toBe('hytopia/zoo-game');
    expect(parsed.worktreeId).toBe('work3');
    expect(parsed.key).toBe('hytopia/zoo-game/work3');
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

  test('parseTerminalIdentity normalizes worktree id from worktreePath fallback', () => {
    const identity = parseTerminalIdentity({
      id: 'legacy-session',
      repository: { name: 'incremental-game' },
      worktreePath: '/home/user/GitHub/games/monogame/incremental-game/work2'
    });
    expect(identity.worktreeId).toBe('work2');
    expect(identity.composedKey).toBe('incremental-game-work2');
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

  test('terminalMatchesWorktree matches fallback terminal id keys without explicit worktree field', () => {
    const parsed = parseWorktreeKey('epic-survivors-work9');
    const terminal = {
      id: 'epic-survivors-work9-server',
      repository: { name: 'epic-survivors' }
    };
    expect(terminalMatchesWorktree(terminal, parsed)).toBe(true);
  });

  test('sessionRecordMatchesWorktree matches recovery records by composed repo/worktree key', () => {
    const parsed = parseWorktreeKey('incremental-game-work2');
    const matched = sessionRecordMatchesWorktree('incremental-game-work2-claude', {
      repositoryName: 'incremental-game',
      worktreeId: 'work2'
    }, parsed);
    expect(matched).toBe(true);
  });

  test('sessionRecordMatchesWorktree avoids work1/work10 false positives', () => {
    const parsed = parseWorktreeKey('zoo-game-work1');
    const matched = sessionRecordMatchesWorktree('zoo-game-work10-claude', {
      repositoryName: 'zoo-game',
      worktreeId: 'work10'
    }, parsed);
    expect(matched).toBe(false);
  });

  test('sessionRecordMatchesWorktree matches by worktree token when repository is missing', () => {
    const parsed = parseWorktreeKey('work6');
    const matched = sessionRecordMatchesWorktree('legacy-session-work6-server', {
      worktreePath: '/home/<user>/GitHub/games/hytopia/zoo/work6'
    }, parsed);
    expect(matched).toBe(true);
  });

  test('thread action close-session defaults can be overridden', () => {
    expect(shouldCloseSessionsForThreadAction('close', undefined)).toBe(false);
    expect(shouldCloseSessionsForThreadAction('archive', undefined)).toBe(false);
    expect(shouldCloseSessionsForThreadAction('close', true)).toBe(true);
    expect(shouldCloseSessionsForThreadAction('archive', true)).toBe(true);
  });
});
