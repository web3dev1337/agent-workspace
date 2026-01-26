const { TaskDependencyService, parsePrTaskId } = require('../../server/taskDependencyService');

describe('TaskDependencyService', () => {
  test('parsePrTaskId parses pr:owner/repo#num', () => {
    expect(parsePrTaskId('pr:web3dev1337/incremental-game#4')).toEqual({
      owner: 'web3dev1337',
      repo: 'incremental-game',
      number: 4
    });
    expect(parsePrTaskId('nope')).toEqual(null);
  });

  test('resolveDependencies marks doneAt as satisfied', async () => {
    const taskRecordService = {
      get: (id) => {
        if (id === 'task:A') return { dependencies: ['task:B'] };
        if (id === 'task:B') return { doneAt: '2026-01-01T00:00:00.000Z' };
        return null;
      }
    };
    const pullRequestService = { getPullRequest: jest.fn() };
    const svc = new TaskDependencyService({ taskRecordService, pullRequestService });

    const deps = await svc.resolveDependencies('task:A');
    expect(deps).toEqual([{ id: 'task:B', satisfied: true, reason: 'doneAt' }]);
    expect(pullRequestService.getPullRequest).not.toHaveBeenCalled();
  });

  test('resolveDependencies marks merged PR as satisfied', async () => {
    const taskRecordService = {
      get: (id) => (id === 'task:A' ? { dependencies: ['pr:o/r#1'] } : null)
    };
    const pullRequestService = {
      getPullRequest: jest.fn().mockResolvedValue({ state: 'MERGED' })
    };
    const svc = new TaskDependencyService({ taskRecordService, pullRequestService });

    const deps = await svc.resolveDependencies('task:A');
    expect(deps[0].id).toEqual('pr:o/r#1');
    expect(deps[0].satisfied).toEqual(true);
    expect(deps[0].reason).toEqual('pr_merged');
  });

  test('buildGraph returns bounded nodes/edges with satisfaction', async () => {
    const records = [
      { id: 'task:A', dependencies: ['task:B', 'pr:o/r#1'] },
      { id: 'task:B', doneAt: '2026-01-01T00:00:00.000Z' },
      { id: 'task:C', dependencies: ['task:A'] }
    ];

    const taskRecordService = {
      get: (id) => records.find(r => r.id === id) || null,
      list: () => records
    };

    const pullRequestService = {
      getPullRequest: jest.fn().mockResolvedValue({ state: 'MERGED' })
    };

    const svc = new TaskDependencyService({ taskRecordService, pullRequestService });
    const graph = await svc.buildGraph({ rootId: 'task:A', depth: 2 });

    const nodeIds = graph.nodes.map(n => n.id).sort();
    expect(nodeIds).toEqual(['pr:o/r#1', 'task:A', 'task:B', 'task:C'].sort());

    const edgeKey = (e) => `${e.from}->${e.to}:${e.satisfied ? '1' : '0'}`;
    const edges = graph.edges.map(edgeKey);
    expect(edges).toContain('task:A->task:B:1');
    expect(edges).toContain('task:A->pr:o/r#1:1');
    expect(edges).toContain('task:C->task:A:0');
  });
});
