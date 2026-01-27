const { ProcessAdvisorService } = require('../../server/processAdvisorService');

describe('ProcessAdvisorService', () => {
  test('returns advice for over-cap conditions', async () => {
    const processStatusService = {
      getStatus: async () => ({
        wip: 5,
        wipMax: 3,
        qByTier: { 1: 2, 2: 2, 3: 0, 4: 0, none: 1 },
        q12: 4,
        qCaps: { q12: 3, q3: 6, q4: 10 }
      })
    };
    const processTelemetryService = {
      getSummary: async () => ({
        avgReviewSeconds: 15 * 60
      })
    };
    const processTaskService = {
      listTasks: async () => ([
        { id: 'pr:x/y#1', kind: 'pr', repository: 'x/y' },
        { id: 'pr:x/y#2', kind: 'pr', repository: 'x/y' }
      ])
    };
    const taskRecordService = {
      get: (id) => (id === 'pr:x/y#1' ? { tier: 3 } : { tier: 3, reviewedAt: '2026-01-01T00:00:00Z' })
    };

    const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
    const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });

    const codes = (result.advice || []).map(a => a.code);
    expect(codes).toContain('wip_over_cap');
    expect(codes).toContain('tier12_over_cap');
    expect(codes).toContain('untagged_tasks');
    expect(codes).toContain('review_slow');
    expect(codes).toContain('tier3_unreviewed_prs');
  });

  test('includes dependency-blocked signal for tier 1/2 PRs', async () => {
    const processStatusService = { getStatus: async () => ({ qByTier: {}, qCaps: {}, wip: 0, wipMax: 0 }) };
    const processTelemetryService = { getSummary: async () => ({ avgReviewSeconds: 0 }) };
    const processTaskService = {
      listTasks: async () => ([
        { id: 'pr:x/y#1', kind: 'pr', repository: 'x/y' }
      ])
    };
    const taskRecordService = {
      get: () => ({ tier: 1 })
    };
    const taskDependencyService = {
      getDependencySummary: async () => ({ total: 2, blocked: 1 })
    };

    const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService, taskDependencyService });
    const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });
    const codes = (result.advice || []).map(a => a.code);
    expect(codes).toContain('tier12_blocked');
  });

  test('does not throw when upstream services fail', async () => {
    const processStatusService = {
      getStatus: async () => {
        throw new Error('status unavailable');
      }
    };
    const processTelemetryService = {
      getSummary: async () => {
        throw new Error('telemetry unavailable');
      }
    };
    const processTaskService = {
      listTasks: async () => {
        throw new Error('tasks unavailable');
      }
    };
    const taskRecordService = {
      list: () => ([
        { id: 'pr:x/y#1', reviewEndedAt: '2026-01-27T00:00:00Z', reviewOutcome: 'approved' }
      ])
    };

    const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
    const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });
    expect(result).toHaveProperty('advice');
    expect(Array.isArray(result.advice)).toBe(true);
    expect(result).toHaveProperty('metrics');
    expect(result.metrics).toHaveProperty('lookbackHours');
  });
});
