const { ProcessTaskService } = require('../../server/processTaskService');

describe('ProcessTaskService', () => {
  test('listTasks returns PRs + ready worktrees + waiting sessions', async () => {
    const pullRequestService = {
      searchPullRequests: jest.fn().mockResolvedValue({
        prs: [
          {
            number: 5,
            title: 'PR title',
            state: 'OPEN',
            url: 'https://example.com/pr/5',
            repository: { name: 'repo', nameWithOwner: 'me/repo' },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-03T00:00:00Z',
            author: { login: 'me' }
          }
        ]
      })
    };

    const worktreeTagService = {
      getAll: () => ({
        '/tmp/work1': { readyForReview: true, updatedAt: '2026-01-02T00:00:00Z' }
      })
    };

    const sessions = new Map();
    sessions.set('s1', {
      id: 's1',
      status: 'waiting',
      type: 'claude',
      worktreeId: 'work1',
      repositoryName: 'repo',
      repositoryType: 'demo',
      statusChangedAt: Date.parse('2026-01-04T00:00:00Z'),
      config: { cwd: '/tmp/work1' }
    });
    sessions.set('s2', { id: 's2', status: 'idle' });

    const sessionManager = { sessions };

    const service = new ProcessTaskService({ sessionManager, worktreeTagService, pullRequestService });
    const tasks = await service.listTasks();
    const prTask = tasks.find(t => t.kind === 'pr' && t.prNumber === 5);

    expect(prTask).toMatchObject({
      id: 'pr:me/repo#5',
      repository: 'me/repo',
      prNumber: 5
    });
    expect(tasks.some(t => t.kind === 'worktree' && t.worktreePath === '/tmp/work1')).toBe(true);
    expect(tasks.some(t => t.kind === 'session' && t.sessionId === 's1')).toBe(true);

    // Sorted by updatedAt desc: session should come first
    expect(tasks[0].kind).toBe('session');
  });
});
