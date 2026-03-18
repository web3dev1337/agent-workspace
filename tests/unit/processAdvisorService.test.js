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

    const wipAdvice = (result.advice || []).find(a => a.code === 'wip_over_cap');
    const wipActions = Array.isArray(wipAdvice?.actions) ? wipAdvice.actions : [];
    expect(wipActions.some(a => a?.action === 'open-prs')).toBe(true);

    const qAdvice = (result.advice || []).find(a => a.code === 'tier12_over_cap');
    const qActions = Array.isArray(qAdvice?.actions) ? qAdvice.actions : [];
    expect(qActions.some(a => a?.action === 'open-prs')).toBe(true);
    expect(qActions.some(a => a?.action === 'queue-conveyor-t2')).toBe(true);

    const reviewSlowAdvice = (result.advice || []).find(a => a.code === 'review_slow');
    expect(reviewSlowAdvice?.message || '').not.toMatch(/button/i);

    const tier3Advice = (result.advice || []).find(a => a.code === 'tier3_unreviewed_prs');
    const actions = Array.isArray(tier3Advice?.actions) ? tier3Advice.actions : [];
    expect(actions.some(a => a?.action === 'queue-next')).toBe(true);
  });

  test('adds triage action for needs_fix backlog', async () => {
    const realNow = Date.now;
    const now = Date.parse('2026-01-27T00:01:00.000Z');
    Date.now = () => now;

    const processStatusService = { getStatus: async () => ({ qByTier: {}, qCaps: {}, wip: 0, wipMax: 0 }) };
    const processTelemetryService = { getSummary: async () => ({ avgReviewSeconds: 0 }) };
    const processTaskService = { listTasks: async () => ([]) };
    const taskRecordService = {
      list: () => ([
        { id: 't1', reviewEndedAt: '2026-01-27T00:00:00.000Z', reviewOutcome: 'needs_fix' },
        { id: 't2', reviewEndedAt: '2026-01-27T00:00:10.000Z', reviewOutcome: 'needs_fix' },
        { id: 't3', reviewEndedAt: '2026-01-27T00:00:20.000Z', reviewOutcome: 'needs_fix' },
      ])
    };

    try {
      const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
      const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });
      const advice = (result.advice || []).find(a => a.code === 'needs_fix_backlog');
      expect(advice).toBeTruthy();
      const actions = Array.isArray(advice?.actions) ? advice.actions : [];
      expect(actions.some(a => a?.action === 'queue-triage')).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  test('adds backlog-growth warning when created >> done', async () => {
    const processStatusService = { getStatus: async () => ({ qByTier: {}, qCaps: {}, wip: 0, wipMax: 0 }) };
    const processTelemetryService = { getSummary: async () => ({ avgReviewSeconds: 0, createdCount: 12, doneCount: 3 }) };
    const processTaskService = { listTasks: async () => ([]) };
    const taskRecordService = { list: () => ([]) };

    const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
    const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });

    const codes = (result.advice || []).map(a => a.code);
    expect(codes).toContain('throughput_negative');

    expect(result.metrics.createdCount).toBe(12);
    expect(result.metrics.doneCount).toBe(3);
    expect(result.metrics.netCreatedMinusDone).toBe(9);

    const advice = (result.advice || []).find(a => a.code === 'throughput_negative');
    const actions = Array.isArray(advice?.actions) ? advice.actions : [];
    expect(actions.some(a => a?.action === 'queue-triage')).toBe(true);
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
    const blockedAdvice = (result.advice || []).find(a => a.code === 'tier12_blocked');
    const actions = Array.isArray(blockedAdvice?.actions) ? blockedAdvice.actions : [];
    expect(actions.some(a => a?.action === 'queue-blockers')).toBe(true);
  });

  test('adds verify + risk signals', async () => {
    const realNow = Date.now;
    const now = 1_700_000_000_000;
    Date.now = () => now;
    const iso = (ms) => new Date(ms).toISOString();

    try {
      const processStatusService = { getStatus: async () => ({ qByTier: {}, qCaps: {}, wip: 0, wipMax: 0 }) };
      const processTelemetryService = { getSummary: async () => ({ avgReviewSeconds: 0, avgVerifyMinutes: 30 }) };
      const processTaskService = {
        listTasks: async () => ([
          { id: 'pr:x/y#1', kind: 'pr', repository: 'x/y' }
        ])
      };
      const taskRecordService = {
        get: () => ({ tier: 1, changeRisk: 'high' }),
        list: () => ([
          { id: 'r1', reviewEndedAt: iso(now - 1_000), reviewOutcome: 'approved' },
          { id: 'r2', reviewEndedAt: iso(now - 2_000), reviewOutcome: 'needs_fix' },
          { id: 'r3', reviewEndedAt: iso(now - 3_000), reviewOutcome: 'commented' }
        ])
      };

      const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
      const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });
      const codes = (result.advice || []).map(a => a.code);
      expect(codes).toContain('verify_slow');
      expect(codes).toContain('verify_missing');
      expect(codes).toContain('risky_tier12');
    } finally {
      Date.now = realNow;
    }
  });

  test('detects dependency cycles from task records', async () => {
    const processStatusService = { getStatus: async () => ({ qByTier: {}, qCaps: {}, wip: 0, wipMax: 0 }) };
    const processTelemetryService = { getSummary: async () => ({ avgReviewSeconds: 0 }) };
    const processTaskService = { listTasks: async () => ([]) };
    const taskRecordService = {
      list: () => ([
        { id: 'pr:x/y#1', dependencies: ['pr:x/y#2'] },
        { id: 'pr:x/y#2', dependencies: ['pr:x/y#1'] }
      ])
    };

    const svc = new ProcessAdvisorService({ processStatusService, processTelemetryService, processTaskService, taskRecordService });
    const result = await svc.getAdvice({ mode: 'mine', lookbackHours: 24, force: true });
    const codes = (result.advice || []).map(a => a.code);
    expect(codes).toContain('dep_cycles');
    expect(result.metrics.depCycleCount).toBeGreaterThanOrEqual(1);
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
