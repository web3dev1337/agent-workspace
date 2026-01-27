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

  test('returns bucketed series + histograms', async () => {
    const realNow = Date.now;
    const now = 1_700_000_000_000;
    Date.now = () => now;
    const iso = (ms) => new Date(ms).toISOString();

    const taskRecordService = {
      list: () => ([
        {
          id: 'a',
          updatedAt: iso(now),
          reviewStartedAt: iso(now - 10_000),
          reviewEndedAt: iso(now),
          promptSentAt: iso(now - 5_000),
          promptChars: 100
        },
        {
          id: 'b',
          updatedAt: iso(now - 2 * 60 * 60 * 1000),
          reviewStartedAt: iso(now - 2 * 60 * 60 * 1000 - 30_000),
          reviewEndedAt: iso(now - 2 * 60 * 60 * 1000),
          promptSentAt: iso(now - 2 * 60 * 60 * 1000 + 2_000),
          promptChars: 300
        }
      ])
    };

    try {
      const svc = new ProcessTelemetryService({ taskRecordService });
      const details = await svc.getDetails({ lookbackHours: 24, bucketMinutes: 60, force: true });

      expect(details).toEqual(expect.objectContaining({
        bucketMinutes: 60,
        reviewedCount: 2,
        promptSentCount: 2
      }));
      expect(Array.isArray(details.series)).toBe(true);
      expect(details.series.length).toBeGreaterThanOrEqual(1);
      expect(details.series[0]).toEqual(expect.objectContaining({
        t: expect.any(Number),
        reviewSamples: expect.any(Number),
        promptSamples: expect.any(Number)
      }));

      const reviewHist = details?.histograms?.reviewSeconds;
      const promptHist = details?.histograms?.promptChars;
      expect(Array.isArray(reviewHist?.bins)).toBe(true);
      expect(Array.isArray(promptHist?.bins)).toBe(true);

      const sumBins = (bins) => bins.reduce((acc, b) => acc + Number(b?.count ?? 0), 0);
      expect(sumBins(reviewHist.bins)).toBe(2);
      expect(sumBins(promptHist.bins)).toBe(2);
      expect(reviewHist.maxCount).toBeGreaterThanOrEqual(1);
      expect(promptHist.maxCount).toBeGreaterThanOrEqual(1);
    } finally {
      Date.now = realNow;
    }
  });

  test('exports telemetry as csv', async () => {
    const realNow = Date.now;
    const now = 1_700_000_000_000;
    Date.now = () => now;
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
          tier: 2,
          ticketProvider: 'trello',
          ticketCardId: 'id,with,comma'
        },
        {
          id: 'b',
          updatedAt: iso(now),
          // telemetry exists via reviewedAt
          reviewStartedAt: iso(now - 20_000),
          reviewedAt: iso(now),
          tier: 1
        },
        {
          id: 'c',
          updatedAt: iso(now),
          // No telemetry -> should be excluded
          tier: 3
        }
      ])
    };

    try {
      const svc = new ProcessTelemetryService({ taskRecordService });
      const csv = await svc.exportCsv({ lookbackHours: 24 });
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('id,updatedAt,reviewStartedAt,reviewEndedAt,promptSentAt,promptChars,tier,ticketProvider,ticketCardId');
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain('a,');
      expect(lines[1]).toContain('"id,with,comma"');
      expect(lines[2]).toContain('b,');
    } finally {
      Date.now = realNow;
    }
  });

  test('exports telemetry as json', async () => {
    const realNow = Date.now;
    const now = 1_700_000_000_000;
    Date.now = () => now;
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
          tier: 2,
          ticketProvider: 'trello',
          ticketCardId: 'card-1'
        },
        {
          id: 'b',
          updatedAt: iso(now),
          // telemetry exists via reviewedAt
          reviewStartedAt: iso(now - 20_000),
          reviewedAt: iso(now),
          tier: 1
        },
        {
          id: 'c',
          updatedAt: iso(now),
          // No telemetry -> should be excluded
          tier: 3
        }
      ])
    };

    try {
      const svc = new ProcessTelemetryService({ taskRecordService });
      const out = await svc.exportJson({ lookbackHours: 24 });
      expect(out).toEqual(expect.objectContaining({
        lookbackHours: 24,
        exportedAt: expect.any(String),
        records: expect.any(Array)
      }));
      expect(out.records.length).toBe(2);
      expect(out.records[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        updatedAt: expect.any(String),
        reviewStartedAt: expect.any(String),
        reviewEndedAt: expect.any(String)
      }));
    } finally {
      Date.now = realNow;
    }
  });
});
