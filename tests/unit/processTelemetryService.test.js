const { ProcessTelemetryService } = require('../../server/processTelemetryService');

describe('ProcessTelemetryService', () => {
  test('computes averages from task records', async () => {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();

    const taskRecordService = {
      list: () => ([
        {
          id: 'a',
          updatedAt: iso(now),
          reviewStartedAt: iso(now - 10_000),
          reviewEndedAt: iso(now),
          promptSentAt: iso(now - 5_000),
          promptChars: 100,
          reviewedAt: iso(now)
        },
        {
          id: 'b',
          updatedAt: iso(now),
          reviewStartedAt: iso(now - 20_000),
          reviewEndedAt: iso(now),
          promptSentAt: iso(now - 4_000),
          promptChars: 300,
          reviewedAt: iso(now)
        },
        {
          id: 'c',
          updatedAt: iso(now),
          // No review timer, no prompt
        }
      ])
    };

    const svc = new ProcessTelemetryService({ taskRecordService });
    const summary = await svc.getSummary({ lookbackHours: 24, force: true });

    expect(summary.recordsConsidered).toBe(3);
    expect(summary.reviewedCount).toBe(2);
    expect(summary.promptSentCount).toBe(2);
    expect(summary.samples.reviewSeconds).toBe(2);
    expect(summary.samples.promptChars).toBe(2);
    expect(summary.avgPromptChars).toBe(200);
    // Reviews: 10s and 20s -> avg 15s
    expect(Math.round(summary.avgReviewSeconds)).toBe(15);
  });
});

