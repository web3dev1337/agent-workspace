const { SessionManager } = require('../../server/sessionManager');

const makeSessionManager = () => {
  const io = { emit: jest.fn() };
  const agentManager = { getAllAgents: () => [] };
  const sm = new SessionManager(io, agentManager);

  sm.worktrees = [];
  sm.sessions = new Map();

  // Avoid spawning PTYs in unit tests.
  sm.createSession = jest.fn((sessionId, config) => {
    sm.sessions.set(sessionId, {
      id: sessionId,
      type: config.type,
      worktreeId: config.worktreeId,
      repositoryName: config.repositoryName,
      repositoryType: config.repositoryType,
      status: 'idle',
      branch: 'unknown',
      config
    });
  });

  return sm;
};

describe('SessionManager.createSessionsForWorktree', () => {
  test('tracks dynamically added worktrees for branch refresh/watchers (single repo)', async () => {
    const sm = makeSessionManager();
    sm.setupGitWatcherForWorktree = jest.fn();

    await sm.createSessionsForWorktree({
      worktreeId: 'work9',
      worktreePath: '/tmp/test-repo/work9',
      repositoryName: null,
      repositoryType: null
    });

    expect(sm.worktrees.some((w) => w.id === 'work9' && w.path === '/tmp/test-repo/work9')).toBe(true);
    expect(sm.setupGitWatcherForWorktree).toHaveBeenCalledWith(expect.objectContaining({ id: 'work9', path: '/tmp/test-repo/work9' }));
  });

  test('tracks dynamically added worktrees for branch refresh/watchers (mixed repo)', async () => {
    const sm = makeSessionManager();
    sm.setupGitWatcherForWorktree = jest.fn();

    await sm.createSessionsForWorktree({
      worktreeId: 'work2',
      worktreePath: '/tmp/another-repo/work2',
      repositoryName: 'my-repo',
      repositoryType: 'node'
    });

    expect(sm.worktrees.some((w) => w.id === 'my-repo-work2' && w.path === '/tmp/another-repo/work2')).toBe(true);
    expect(sm.setupGitWatcherForWorktree).toHaveBeenCalledWith(expect.objectContaining({ id: 'my-repo-work2', path: '/tmp/another-repo/work2' }));
  });

  test('does not duplicate tracked worktrees on repeated calls', async () => {
    const sm = makeSessionManager();
    sm.setupGitWatcherForWorktree = jest.fn();

    await sm.createSessionsForWorktree({
      worktreeId: 'work3',
      worktreePath: '/tmp/dupe-repo/work3',
      repositoryName: 'dupe',
      repositoryType: null
    });
    await sm.createSessionsForWorktree({
      worktreeId: 'work3',
      worktreePath: '/tmp/dupe-repo/work3',
      repositoryName: 'dupe',
      repositoryType: null
    });

    const matches = sm.worktrees.filter((w) => w.id === 'dupe-work3');
    expect(matches).toHaveLength(1);
  });
});

