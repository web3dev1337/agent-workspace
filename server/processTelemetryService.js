const { TTLCache } = require('./utils/ttlCache');

const DEFAULT_LOOKBACK_HOURS = 24;

const parseIso = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
};

const clampNonNegative = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return null;
  return x;
};

class ProcessTelemetryService {
  constructor({ taskRecordService } = {}) {
    this.taskRecordService = taskRecordService;
    this.cache = new TTLCache({ defaultTtlMs: 25_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessTelemetryService.instance) {
      ProcessTelemetryService.instance = new ProcessTelemetryService(deps);
    }
    return ProcessTelemetryService.instance;
  }

  getSummary({ lookbackHours = DEFAULT_LOOKBACK_HOURS, force = false } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const cacheKey = `telemetry:${hours}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
      const rows = this.taskRecordService?.list?.() || [];

      let recordsConsidered = 0;
      let reviewedCount = 0;
      let promptSentCount = 0;

      const reviewSeconds = [];
      const promptChars = [];

      for (const r of rows) {
        const id = r?.id;
        if (!id) continue;

        const updatedAtMs = parseIso(r?.updatedAt);
        if (updatedAtMs && updatedAtMs < cutoffMs) continue;
        recordsConsidered += 1;

        if (r?.reviewedAt) reviewedCount += 1;

        const startMs = parseIso(r?.reviewStartedAt);
        const endMs = parseIso(r?.reviewEndedAt || r?.reviewedAt);
        if (startMs && endMs && endMs >= startMs) {
          const seconds = (endMs - startMs) / 1000;
          if (seconds >= 0 && seconds <= hours * 60 * 60) {
            reviewSeconds.push(seconds);
          }
        }

        const ps = parseIso(r?.promptSentAt);
        if (ps) {
          promptSentCount += 1;
          const pc = clampNonNegative(r?.promptChars);
          if (pc !== null) promptChars.push(pc);
        }
      }

      const avg = (arr) => {
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      };

      return {
        lookbackHours: hours,
        recordsConsidered,
        reviewedCount,
        promptSentCount,
        avgReviewSeconds: avg(reviewSeconds),
        avgPromptChars: avg(promptChars),
        samples: {
          reviewSeconds: reviewSeconds.length,
          promptChars: promptChars.length
        }
      };
    }, { force });
  }
}

module.exports = { ProcessTelemetryService };

