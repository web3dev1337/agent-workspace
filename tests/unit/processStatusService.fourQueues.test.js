const { ProcessStatusService } = require('../../server/processStatusService');

describe('ProcessStatusService fourQueues snapshot', () => {
  test('includes BWQX counts (review + rework) and reports backlog unsupported', async () => {
    const processTaskService = {
      listTasks: async () => ([
        { id: 'pr:owner/repo#1', kind: 'pr', status: 'open', updatedAt: new Date().toISOString() },
        { id: 'pr:owner/repo#2', kind: 'pr', status: 'open', updatedAt: new Date().toISOString() },
        { id: 'worktree:/tmp/repo/work1', kind: 'worktree', status: 'ready_for_review', updatedAt: new Date().toISOString() }
      ])
    };

    const taskRecordService = {
      get: (id) => {
        if (id === 'pr:owner/repo#1') return { tier: 2, reviewOutcome: 'needs_fix' };
        if (id === 'pr:owner/repo#2') return { tier: 1 };
        if (id === 'worktree:/tmp/repo/work1') return { tier: 3 };
        return null;
      }
    };

    const sessionManager = {
      sessions: new Map([
        ['s1', { id: 's1', status: 'busy', repositoryName: 'repo-a', statusChangedAt: new Date().toISOString() }],
        ['s2', { id: 's2', status: 'busy', repositoryName: 'repo-b', statusChangedAt: new Date().toISOString() }]
      ])
    };

    const workspaceManager = { workspaces: new Map() };

    const svc = new ProcessStatusService({
      processTaskService,
      taskRecordService,
      sessionManager,
      workspaceManager,
      userSettingsService: { settings: {} }
    });

    const status = await svc.getStatus({ mode: 'mine', force: true });
    expect(status.fourQueues).toEqual({
      backlog: { count: null, supported: false },
      inflight: { count: 2, supported: true },
      review: { count: 3, supported: true },
      rework: { count: 1, supported: true }
    });
  });
});

