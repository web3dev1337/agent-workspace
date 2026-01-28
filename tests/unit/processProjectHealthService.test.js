const { ProcessProjectHealthService } = require('../../server/processProjectHealthService');

describe('ProcessProjectHealthService', () => {
  test('groups records by repo and computes backlog + cycle time series', async () => {
    const realNow = Date.now;
    const now = Date.parse('2026-01-10T00:00:00.000Z');
    Date.now = () => now;

    const taskRecordService = {
      list: () => ([
        {
          id: 'pr:o/r#1',
          createdAt: '2026-01-01T00:00:00.000Z',
          prMergedAt: '2026-01-02T00:00:00.000Z',
          reviewEndedAt: '2026-01-02T00:30:00.000Z',
          reviewOutcome: 'approved',
          tier: 1,
          changeRisk: 'medium'
        },
        {
          id: 'pr:o/r#2',
          createdAt: '2026-01-03T00:00:00.000Z',
          tier: 2,
          changeRisk: 'high'
        },
        {
          id: 'pr:a/b#1',
          createdAt: '2026-01-04T00:00:00.000Z',
          prMergedAt: '2026-01-09T00:00:00.000Z',
          reviewEndedAt: '2026-01-05T00:10:00.000Z',
          reviewOutcome: 'needs_fix',
          tier: 3,
          changeRisk: 'low'
        }
      ])
    };

    try {
      const svc = new ProcessProjectHealthService({ taskRecordService });
      const data = await svc.getHealth({ lookbackHours: 24 * 10, bucketMinutes: 24 * 60, force: true });

      const repos = Array.isArray(data?.repos) ? data.repos : [];
      const or = repos.find(r => r.repo === 'o/r');
      const ab = repos.find(r => r.repo === 'a/b');

      expect(or).toBeTruthy();
      expect(or.openBacklog).toBe(1);
      expect(or.openRiskCounts.high).toBe(1);
      expect(or.openTierCounts[2]).toBe(1);
      expect(or.totals.createdCount).toBe(2);
      expect(or.totals.mergedCount).toBe(1);
      expect(or.totals.reviewedCount).toBe(1);
      expect(or.totals.needsFixCount).toBe(0);
      expect(or.totals.avgCycleHours).toBeCloseTo(24, 3);

      expect(ab).toBeTruthy();
      expect(ab.openBacklog).toBe(0);
      expect(ab.totals.mergedCount).toBe(1);
      expect(ab.totals.needsFixCount).toBe(1);
      expect(ab.totals.p50CycleHours).toBeCloseTo(120, 3);

      const series = Array.isArray(or.series) ? or.series : [];
      expect(series.length).toBeGreaterThan(0);
      expect(series.some(b => Number(b.createdCount) > 0)).toBe(true);
      expect(series.some(b => Number(b.mergedCount) > 0)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

