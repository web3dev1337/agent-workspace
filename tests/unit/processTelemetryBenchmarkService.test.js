const { ProcessTelemetryBenchmarkService } = require('../../server/processTelemetryBenchmarkService');

const createSnapshotStore = () => {
  const store = new Map();
  let sequence = 0;
  return {
    async create(payload) {
      sequence += 1;
      const id = `snap${String(sequence).padStart(2, '0')}`;
      const createdAt = new Date(Date.UTC(2026, 1, sequence, 12, 0, 0)).toISOString();
      store.set(id, { id, createdAt, ...payload });
      return { id, createdAt };
    },
    async get(id) {
      const hit = store.get(id);
      if (!hit) throw new Error('not found');
      return hit;
    },
    list() {
      return Array.from(store.values())
        .map((value) => ({ id: value.id, updatedAt: value.createdAt }))
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    }
  };
};

describe('ProcessTelemetryBenchmarkService', () => {
  test('captureSnapshot stores telemetry_benchmark snapshot with metrics', async () => {
    const snapshotService = createSnapshotStore();
    const service = new ProcessTelemetryBenchmarkService({
      processTelemetryService: {
        async getDetails() {
          return {
            lookbackHours: 24,
            bucketMinutes: 60,
            reviewedCount: 8,
            doneCount: 5,
            prMergedCount: 3,
            avgReviewSeconds: 540,
            outcomeCounts: { approved: 5, needs_fix: 2, commented: 1, skipped: 0, other: 0 }
          };
        }
      },
      processStatusService: {
        async getStatus() {
          return {
            level: 'ok',
            wip: 2,
            wipMax: 3,
            fourQueues: {
              review: { count: 4, supported: true },
              rework: { count: 1, supported: true }
            }
          };
        }
      },
      telemetrySnapshotService: snapshotService,
      firstRunCollector: async () => ({
        summary: { ready: true, blockingCount: 0, warningCount: 1, repairableCount: 1 }
      })
    });

    const created = await service.captureSnapshot({ label: 'release v1.2.0', lookbackHours: 24, bucketMinutes: 60 });
    expect(created).toEqual(expect.objectContaining({
      id: expect.any(String),
      label: 'release v1.2.0',
      lookbackHours: 24,
      bucketMinutes: 60
    }));

    const payload = await snapshotService.get(created.id);
    expect(payload.kind).toBe('telemetry_benchmark');
    expect(payload.params).toEqual(expect.objectContaining({ label: 'release v1.2.0' }));
    expect(payload.data.metrics).toEqual(expect.objectContaining({
      onboarding: expect.objectContaining({ score: expect.any(Number) }),
      runtime: expect.objectContaining({ score: expect.any(Number) }),
      review: expect.objectContaining({ score: expect.any(Number), doneCount: 5 })
    }));
  });

  test('getBenchmarkDashboard returns live + snapshot rows with deltas', async () => {
    const snapshotService = createSnapshotStore();
    await snapshotService.create({
      kind: 'telemetry_benchmark',
      params: { label: 'release baseline', lookbackHours: 24, bucketMinutes: 60 },
      data: {
        label: 'release baseline',
        metrics: {
          onboarding: { score: 70 },
          runtime: { score: 65 },
          review: { score: 60, avgReviewSeconds: 900, doneCount: 4, prMergedCount: 1 }
        }
      }
    });

    const service = new ProcessTelemetryBenchmarkService({
      processTelemetryService: {
        async getDetails() {
          return {
            lookbackHours: 24,
            bucketMinutes: 60,
            reviewedCount: 8,
            doneCount: 6,
            prMergedCount: 2,
            avgReviewSeconds: 600,
            outcomeCounts: { approved: 6, needs_fix: 1, commented: 1, skipped: 0, other: 0 }
          };
        }
      },
      processStatusService: {
        async getStatus() {
          return {
            level: 'ok',
            wip: 1,
            wipMax: 3,
            fourQueues: {
              review: { count: 2, supported: true },
              rework: { count: 0, supported: true }
            }
          };
        }
      },
      telemetrySnapshotService: snapshotService,
      firstRunCollector: async () => ({
        summary: { ready: true, blockingCount: 0, warningCount: 0, repairableCount: 0 }
      })
    });

    const dashboard = await service.getBenchmarkDashboard({ limit: 5, lookbackHours: 24, bucketMinutes: 60 });
    expect(dashboard.rows[0].id).toBe('live');
    expect(Array.isArray(dashboard.rows)).toBe(true);
    expect(dashboard.rows.length).toBeGreaterThan(1);
    expect(dashboard.rows[0].deltaFromPrevious).toEqual(expect.objectContaining({
      onboardingScore: expect.any(Number),
      runtimeScore: expect.any(Number),
      reviewScore: expect.any(Number)
    }));
  });

  test('buildReleaseNotes compares live against latest snapshot', async () => {
    const snapshotService = createSnapshotStore();
    await snapshotService.create({
      kind: 'telemetry_benchmark',
      params: { label: 'release previous', lookbackHours: 24, bucketMinutes: 60 },
      data: {
        label: 'release previous',
        metrics: {
          onboarding: { score: 60 },
          runtime: { score: 50 },
          review: { score: 45, avgReviewSeconds: 1200, doneCount: 2, prMergedCount: 1 }
        }
      }
    });

    const service = new ProcessTelemetryBenchmarkService({
      processTelemetryService: {
        async getDetails() {
          return {
            lookbackHours: 24,
            bucketMinutes: 60,
            reviewedCount: 10,
            doneCount: 7,
            prMergedCount: 3,
            avgReviewSeconds: 500,
            outcomeCounts: { approved: 7, needs_fix: 2, commented: 1, skipped: 0, other: 0 }
          };
        }
      },
      processStatusService: {
        async getStatus() {
          return {
            level: 'ok',
            wip: 2,
            wipMax: 3,
            fourQueues: {
              review: { count: 2, supported: true },
              rework: { count: 1, supported: true }
            }
          };
        }
      },
      telemetrySnapshotService: snapshotService,
      firstRunCollector: async () => ({
        summary: { ready: true, blockingCount: 0, warningCount: 0, repairableCount: 0 }
      })
    });

    const notes = await service.buildReleaseNotes({ currentId: 'live', lookbackHours: 24, bucketMinutes: 60 });
    expect(notes.markdown).toContain('## Release telemetry benchmark');
    expect(notes.markdown).toContain('Current: live');
    expect(notes.markdown).toContain('Baseline: release previous');
    expect(notes.delta).toEqual(expect.objectContaining({
      onboardingScore: expect.any(Number),
      runtimeScore: expect.any(Number),
      reviewScore: expect.any(Number)
    }));
  });
});
