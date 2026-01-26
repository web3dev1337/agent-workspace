const { TaskDependencyService, parsePrTaskId, parseTrelloTaskId, detectCycles } = require('../../server/taskDependencyService');

describe('TaskDependencyService', () => {
  test('parsePrTaskId parses pr:owner/repo#num', () => {
    expect(parsePrTaskId('pr:web3dev1337/incremental-game#4')).toEqual({
      owner: 'web3dev1337',
      repo: 'incremental-game',
      number: 4
    });
    expect(parsePrTaskId('nope')).toEqual(null);
  });

  test('parseTrelloTaskId parses trello ids and URLs', () => {
    expect(parseTrelloTaskId('trello:AbC123')).toEqual({ shortLink: 'AbC123' });
    expect(parseTrelloTaskId('https://trello.com/c/XYZ999/whatever')).toEqual({ shortLink: 'XYZ999' });
    expect(parseTrelloTaskId('nope')).toEqual(null);
  });

  test('detectCycles finds simple cycle', () => {
    const cycles = detectCycles({
      nodeIds: ['A', 'B', 'C'],
      edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }, { from: 'B', to: 'C' }],
      limit: 10
    });
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].join('>')).toContain('A');
    expect(cycles[0].join('>')).toContain('B');
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

  test('resolveDependencies supports trello: dependencies (closed card => satisfied)', async () => {
    const taskRecordService = {
      get: (id) => (id === 'task:A' ? { dependencies: ['trello:AbC123'] } : null)
    };
    const pullRequestService = { getPullRequest: jest.fn() };
    const provider = {
      getCard: jest.fn().mockResolvedValue({ closed: true }),
      getDependencies: jest.fn().mockResolvedValue({ items: [] })
    };
    const taskTicketingService = { getProvider: jest.fn().mockReturnValue(provider) };

    const svc = new TaskDependencyService({ taskRecordService, pullRequestService, taskTicketingService });
    const deps = await svc.resolveDependencies('task:A');
    expect(deps[0].id).toBe('trello:AbC123');
    expect(deps[0].satisfied).toBe(true);
    expect(deps[0].reason).toBe('trello_closed');
  });

  test('buildGraph expands trello dependencies with per-edge satisfaction', async () => {
    const records = [
      { id: 'task:A', dependencies: ['trello:AAA111'] }
    ];
    const taskRecordService = {
      get: (id) => records.find(r => r.id === id) || null,
      list: () => records
    };
    const pullRequestService = { getPullRequest: jest.fn() };
    const provider = {
      getCard: jest.fn().mockResolvedValue({ closed: false, name: 'Card AAA', url: 'https://trello.com/c/AAA111' }),
      getDependencies: jest.fn().mockResolvedValue({
        items: [
          { shortLink: 'BBB222', url: 'https://trello.com/c/BBB222', state: 'complete' },
          { shortLink: 'CCC333', url: 'https://trello.com/c/CCC333', state: 'incomplete' }
        ]
      })
    };
    const taskTicketingService = { getProvider: jest.fn().mockReturnValue(provider) };

    const svc = new TaskDependencyService({ taskRecordService, pullRequestService, taskTicketingService });
    const graph = await svc.buildGraph({ rootId: 'task:A', depth: 3 });

    const edgeKey = (e) => `${e.from}->${e.to}:${e.satisfied ? '1' : '0'}:${e.reason || ''}`;
    const edges = graph.edges.map(edgeKey);
    expect(edges).toContain('task:A->trello:AAA111:0:trello_open');
    expect(edges).toContain('trello:AAA111->trello:BBB222:1:trello_dep_complete');
    expect(edges).toContain('trello:AAA111->trello:CCC333:0:trello_dep_incomplete');
    expect(graph.nodes.find(n => n.id === 'trello:AAA111')?.label).toBe('Card AAA');
  });
});
