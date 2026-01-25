const {
  computeQueueCounts,
  computeWipFromSessions,
  computeWipFromWorkspaces
} = require('../../server/processStatusService');

describe('ProcessStatusService helpers', () => {
  test('computeQueueCounts buckets by tier from task records', () => {
    const tasks = [
      { id: 'pr:a/b#1' },
      { id: 'pr:a/b#2' },
      { id: 'worktree:/tmp/x' }
    ];

    const taskRecordService = {
      get: (id) => {
        if (id === 'pr:a/b#1') return { tier: 1 };
        if (id === 'pr:a/b#2') return { tier: 3 };
        return null;
      }
    };

    const result = computeQueueCounts({ tasks, taskRecordService });
    expect(result.counts).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0, none: 1 });
    expect(result.q12).toBe(1);
    expect(result.qTotal).toBe(3);
  });

  test('computeWipFromSessions counts distinct repos recently active', () => {
    const sessions = new Map();
    sessions.set('s1', { id: 's1', status: 'running', repositoryName: 'repo-a', statusChangedAt: new Date().toISOString() });
    sessions.set('s2', { id: 's2', status: 'waiting', repositoryName: 'repo-a', statusChangedAt: new Date().toISOString() });
    sessions.set('s3', { id: 's3', status: 'busy', repositoryName: 'repo-b', statusChangedAt: new Date().toISOString() });
    sessions.set('s4', { id: 's4', status: 'stopped', repositoryName: 'repo-c', statusChangedAt: new Date().toISOString() });

    const sessionManager = { sessions };
    const wip = computeWipFromSessions({ sessionManager, lookbackHours: 24 });
    expect(wip).toEqual({ wip: 2, kind: 'sessions' });
  });

  test('computeWipFromWorkspaces counts recently accessed workspaces', () => {
    const now = Date.now();
    const workspaces = new Map();
    workspaces.set('w1', { id: 'w1', lastAccess: new Date(now - 1 * 60 * 60 * 1000).toISOString() });
    workspaces.set('w2', { id: 'w2', lastAccess: new Date(now - 30 * 60 * 60 * 1000).toISOString() });
    workspaces.set('w3', { id: 'w3', lastAccess: new Date(now - 2 * 60 * 60 * 1000).toISOString() });

    const workspaceManager = { workspaces };
    const wip = computeWipFromWorkspaces({ workspaceManager, lookbackHours: 24 });
    expect(wip).toEqual({ wip: 2, kind: 'workspaces' });
  });
});

