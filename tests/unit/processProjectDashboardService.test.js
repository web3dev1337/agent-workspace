const { ProcessProjectDashboardService } = require('../../server/processProjectDashboardService');

describe('ProcessProjectDashboardService', () => {
  test('groups open PRs by repo and joins task records', async () => {
    const prs = [
      {
        number: 1,
        title: 'One',
        url: 'https://github.com/acme/foo/pull/1',
        updatedAt: '2026-01-27T00:00:00.000Z',
        isDraft: false,
        repository: { owner: { login: 'acme' }, name: 'foo' }
      },
      {
        number: 2,
        title: 'Two',
        url: 'https://github.com/acme/foo/pull/2',
        updatedAt: '2026-01-27T00:00:10.000Z',
        isDraft: true,
        repository: { owner: { login: 'acme' }, name: 'foo' }
      },
      {
        number: 3,
        title: 'Three',
        url: 'https://github.com/acme/bar/pull/3',
        updatedAt: '2026-01-27T00:00:20.000Z',
        isDraft: false,
        repository: { owner: { login: 'acme' }, name: 'bar' }
      }
    ];

    const pullRequestService = {
      searchPullRequests: async () => ({ prs })
    };

    const records = new Map([
      ['pr:acme/foo#1', { id: 'pr:acme/foo#1', tier: 3, changeRisk: 'high', reviewedAt: null, updatedAt: '2026-01-27T00:01:00.000Z' }],
      ['pr:acme/foo#2', { id: 'pr:acme/foo#2', tier: 2, changeRisk: 'low', reviewedAt: '2026-01-27T00:02:00.000Z', updatedAt: '2026-01-27T00:02:00.000Z' }],
      ['pr:acme/bar#3', { id: 'pr:acme/bar#3', tier: null, changeRisk: null, reviewedAt: null, updatedAt: '2026-01-27T00:03:00.000Z' }]
    ]);

    const taskRecordService = {
      get: (id) => records.get(id) || null,
      list: () => Array.from(records.values())
    };

    const svc = new ProcessProjectDashboardService({ pullRequestService, taskRecordService });
    const summary = await svc.getSummary({ mode: 'mine', lookbackHours: 24, limit: 50, force: true });

    expect(summary.totals.prsOpen).toBe(3);
    expect(summary.repos.map(r => r.repo).sort()).toEqual(['acme/bar', 'acme/foo']);

    const foo = summary.repos.find(r => r.repo === 'acme/foo');
    expect(foo.prsOpen).toBe(2);
    expect(foo.prsDraft).toBe(1);
    expect(foo.prsUnreviewed).toBe(1);
    expect(foo.tierCounts[3]).toBe(1);
    expect(foo.riskCounts.high).toBe(1);

    const bar = summary.repos.find(r => r.repo === 'acme/bar');
    expect(bar.prsOpen).toBe(1);
  });
});

