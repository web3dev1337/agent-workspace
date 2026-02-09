const {
  normalizeRepositoryRootForWorktrees,
  collectRepositoryWorktreeIds,
  collectActiveThreadWorktreeIds,
  pickReusableWorktreeId
} = require('../../server/threadWorktreeSelection');

describe('threadWorktreeSelection', () => {
  describe('normalizeRepositoryRootForWorktrees', () => {
    test('strips master suffix', () => {
      expect(normalizeRepositoryRootForWorktrees('/tmp/repo/master')).toBe('/tmp/repo');
    });

    test('keeps worktree path when parent does not look like repo root', () => {
      expect(normalizeRepositoryRootForWorktrees('/tmp/repo/work3')).toBe('/tmp/repo/work3');
    });
  });

  test('collectRepositoryWorktreeIds picks matching repo terminals', () => {
    const workspace = {
      terminals: [
        { id: 'alpha-work1-claude', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work1' },
        { id: 'alpha-work2-server', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work2' },
        { id: 'beta-work1-claude', repository: { name: 'beta', path: '/tmp/beta' }, worktree: 'work1' }
      ]
    };

    expect(collectRepositoryWorktreeIds(workspace, { repositoryPath: '/tmp/alpha' })).toEqual(['work1', 'work2']);
    expect(collectRepositoryWorktreeIds(workspace, { repositoryName: 'beta' })).toEqual(['work1']);
  });

  test('collectActiveThreadWorktreeIds filters by repository context', () => {
    const threads = [
      { status: 'active', repositoryPath: '/tmp/alpha', worktreeId: 'work1' },
      { status: 'active', repositoryPath: '/tmp/alpha', worktreeId: 'work3' },
      { status: 'active', repositoryPath: '/tmp/beta', worktreeId: 'work2' }
    ];

    const ids = collectActiveThreadWorktreeIds(threads, { repositoryPath: '/tmp/alpha' });
    expect(Array.from(ids).sort()).toEqual(['work1', 'work3']);
  });

  test('pickReusableWorktreeId prefers available worktree with live agent session', () => {
    const workspace = {
      terminals: [
        { id: 'alpha-work1-claude', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work1' },
        { id: 'alpha-work2-claude', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work2' },
        { id: 'alpha-work3-claude', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work3' }
      ]
    };

    const threadRows = [
      { status: 'active', repositoryPath: '/tmp/alpha', worktreeId: 'work1' }
    ];

    const sessionRows = [
      ['alpha-work2-claude', { id: 'alpha-work2-claude', type: 'claude', status: 'idle', worktreeId: 'work2', repositoryName: 'alpha', config: { cwd: '/tmp/alpha/work2' } }],
      ['alpha-work3-claude', { id: 'alpha-work3-claude', type: 'claude', status: 'dead', worktreeId: 'work3', repositoryName: 'alpha', config: { cwd: '/tmp/alpha/work3' } }]
    ];

    expect(pickReusableWorktreeId({
      workspace,
      repositoryPath: '/tmp/alpha',
      repositoryName: 'alpha',
      threadRows,
      sessionRows
    })).toBe('work2');
  });

  test('pickReusableWorktreeId returns empty when all candidates have active threads', () => {
    const workspace = {
      terminals: [
        { id: 'alpha-work1-claude', repository: { name: 'alpha', path: '/tmp/alpha' }, worktree: 'work1' }
      ]
    };

    const threadRows = [
      { status: 'active', repositoryPath: '/tmp/alpha', worktreeId: 'work1' }
    ];

    expect(pickReusableWorktreeId({
      workspace,
      repositoryPath: '/tmp/alpha',
      repositoryName: 'alpha',
      threadRows,
      sessionRows: []
    })).toBe('');
  });
});
