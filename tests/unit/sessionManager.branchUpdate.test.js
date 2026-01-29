const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager branch updates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('startBranchRefresh uses worktree.worktreeId when present', () => {
    const io = { emit: jest.fn() };
    const sessionManager = new SessionManager(io, null);
    sessionManager.branchRefreshMs = 10;
    sessionManager.worktrees = [
      { id: 'repo-a-work2', worktreeId: 'work2', path: '/tmp/repo-a/work2' },
      { id: 'work1', path: '/tmp/repo-a/work1' }
    ];

    const updateSpy = jest
      .spyOn(sessionManager, 'updateGitBranch')
      .mockImplementation(() => Promise.resolve());

    sessionManager.startBranchRefresh();
    jest.advanceTimersByTime(11);

    expect(updateSpy).toHaveBeenCalledWith('work2', '/tmp/repo-a/work2');
    expect(updateSpy).toHaveBeenCalledWith('work1', '/tmp/repo-a/work1');
  });

  test('updateGitBranch falls back to matching by cwd path', async () => {
    const io = { emit: jest.fn() };
    const sessionManager = new SessionManager(io, null);
    const gitHelper = {
      getCurrentBranch: jest.fn(async () => 'feature/test'),
      getRemoteUrl: jest.fn(async () => 'git@github.com:owner/repo.git'),
      getDefaultBranch: jest.fn(async () => 'main'),
      checkForExistingPR: jest.fn(async () => null)
    };
    sessionManager.setGitHelper(gitHelper);

    sessionManager.sessions.set('work2-claude', {
      id: 'work2-claude',
      type: 'claude',
      worktreeId: 'work2',
      config: { cwd: '/tmp/repo-a/work2/' },
      branch: 'unknown'
    });
    sessionManager.sessions.set('work2-server', {
      id: 'work2-server',
      type: 'server',
      worktreeId: 'work2',
      config: { cwd: '/tmp/repo-a/work2/' },
      branch: 'unknown'
    });

    await sessionManager.updateGitBranch('repo-a-work2', '/tmp/repo-a/work2', true);

    expect(sessionManager.sessions.get('work2-claude').branch).toBe('feature/test');
    expect(sessionManager.sessions.get('work2-server').branch).toBe('feature/test');

    expect(io.emit).toHaveBeenCalledWith(
      'branch-update',
      expect.objectContaining({ sessionId: 'work2-claude', branch: 'feature/test' })
    );
    expect(io.emit).toHaveBeenCalledWith(
      'branch-update',
      expect.objectContaining({ sessionId: 'work2-server', branch: 'feature/test' })
    );
  });
});

