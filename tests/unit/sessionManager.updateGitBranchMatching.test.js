const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager.updateGitBranch matching', () => {
  test('updates mixed-repo sessions even when session cwd is a subfolder of worktree path', async () => {
    const io = { emit: jest.fn() };
    const agentManager = { getAllAgents: () => [] };
    const sm = new SessionManager(io, agentManager);

    sm.sessions = new Map([
      ['my-repo-work1-claude', {
        id: 'my-repo-work1-claude',
        type: 'claude',
        worktreeId: 'work1',
        repositoryName: 'my-repo',
        status: 'idle',
        branch: 'unknown',
        config: { cwd: '/tmp/repo/work1/src' }
      }]
    ]);

    sm.gitHelper = {
      getCurrentBranch: jest.fn().mockResolvedValue('feature/test'),
      getRemoteUrl: jest.fn().mockResolvedValue(null),
      getDefaultBranch: jest.fn().mockResolvedValue('master'),
      checkForExistingPR: jest.fn().mockResolvedValue(null),
      clearCacheForPath: jest.fn()
    };

    await sm.updateGitBranch('work1', '/tmp/repo/work1', true);

    const updated = sm.sessions.get('my-repo-work1-claude');
    expect(updated.branch).toBe('feature/test');
    expect(io.emit).toHaveBeenCalledWith('branch-update', expect.objectContaining({
      sessionId: 'my-repo-work1-claude',
      branch: 'feature/test'
    }));
  });
});

