const { TTLCache } = require('./utils/ttlCache');

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_BUCKET_MINUTES = 60;

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

        if (r?.reviewEndedAt || r?.reviewedAt) reviewedCount += 1;

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

  getDetails({ lookbackHours = DEFAULT_LOOKBACK_HOURS, bucketMinutes = DEFAULT_BUCKET_MINUTES, force = false } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const bucket = Number(bucketMinutes) || DEFAULT_BUCKET_MINUTES;
    const safeBucket = Math.max(5, Math.min(24 * 60, Math.round(bucket)));
    const cacheKey = `telemetry:details:${hours}:${safeBucket}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const summary = await this.getSummary({ lookbackHours: hours, force: true });
      const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
      const rows = this.taskRecordService?.list?.() || [];

      const bucketMs = safeBucket * 60 * 1000;
      const bucketKeyFor = (t) => Math.floor(t / bucketMs) * bucketMs;

      const buckets = new Map(); // bucketStartMs -> { reviewSeconds:[], promptChars:[] }
      const allReviewSeconds = [];
      const allPromptChars = [];

      const addToBucket = (key, kind, value) => {
        if (!Number.isFinite(key)) return;
        if (!buckets.has(key)) buckets.set(key, { reviewSeconds: [], promptChars: [] });
        const b = buckets.get(key);
        if (kind === 'reviewSeconds') b.reviewSeconds.push(value);
        if (kind === 'promptChars') b.promptChars.push(value);
      };

      for (const r of rows) {
        const updatedAtMs = parseIso(r?.updatedAt);
        if (updatedAtMs && updatedAtMs < cutoffMs) continue;

        const startMs = parseIso(r?.reviewStartedAt);
        const endMs = parseIso(r?.reviewEndedAt || r?.reviewedAt);
        if (startMs && endMs && endMs >= startMs) {
          const seconds = (endMs - startMs) / 1000;
          if (seconds >= 0 && seconds <= hours * 60 * 60) {
            allReviewSeconds.push(seconds);
            addToBucket(bucketKeyFor(endMs), 'reviewSeconds', seconds);
          }
        }

        const ps = parseIso(r?.promptSentAt);
        if (ps) {
          const pc = clampNonNegative(r?.promptChars);
          if (pc !== null) {
            allPromptChars.push(pc);
            addToBucket(bucketKeyFor(ps), 'promptChars', pc);
          }
        }
      }

      const avg = (arr) => {
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
      };

      const buildHistogram = (arr, { bins = 12, min = null, max = null } = {}) => {
        const values = (Array.isArray(arr) ? arr : []).filter((n) => Number.isFinite(Number(n)));
        if (!values.length) return { bins: [], min: null, max: null, maxCount: 0 };
        const minVal = min !== null ? Number(min) : Math.min(...values);
        const maxVal = max !== null ? Number(max) : Math.max(...values);
        const safeMin = Number.isFinite(minVal) ? minVal : 0;
        const safeMax = Number.isFinite(maxVal) ? maxVal : safeMin;
        if (safeMax <= safeMin) {
          return { bins: [{ min: safeMin, max: safeMax, count: values.length }], min: safeMin, max: safeMax, maxCount: values.length };
        }
        const nBins = Math.max(4, Math.min(40, Math.round(bins)));
        const width = (safeMax - safeMin) / nBins;
        const out = Array.from({ length: nBins }, (_, i) => ({
          min: safeMin + i * width,
          max: safeMin + (i + 1) * width,
          count: 0
        }));
        for (const v of values) {
          const idx = Math.min(nBins - 1, Math.max(0, Math.floor((v - safeMin) / width)));
          out[idx].count += 1;
        }
        const maxCount = out.reduce((m, b) => Math.max(m, b.count), 0);
        return { bins: out, min: safeMin, max: safeMax, maxCount };
      };

      const series = Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([t, b]) => ({
          t,
          reviewSamples: b.reviewSeconds.length,
          avgReviewSeconds: avg(b.reviewSeconds),
          promptSamples: b.promptChars.length,
          avgPromptChars: avg(b.promptChars)
        }));

      return {
        ...summary,
        bucketMinutes: safeBucket,
        series,
        histograms: {
          reviewSeconds: buildHistogram(allReviewSeconds, { bins: 14 }),
          promptChars: buildHistogram(allPromptChars, { bins: 14 })
        }
      };
    }, { force });
  }

  exportCsv({ lookbackHours = DEFAULT_LOOKBACK_HOURS } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const rows = this.taskRecordService?.list?.() || [];

    const escape = (v) => {
      const s = String(v ?? '');
      if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = [
      'id',
      'updatedAt',
      'reviewStartedAt',
      'reviewEndedAt',
      'promptSentAt',
      'promptChars',
      'tier',
      'ticketProvider',
      'ticketCardId'
    ];

    const lines = [header.join(',')];
    for (const r of rows) {
      const updatedAtMs = parseIso(r?.updatedAt);
      if (updatedAtMs && updatedAtMs < cutoffMs) continue;
      const hasTelemetry = !!(r?.reviewStartedAt || r?.reviewEndedAt || r?.promptSentAt || r?.promptChars);
      if (!hasTelemetry) continue;

      const line = [
        escape(r?.id || ''),
        escape(r?.updatedAt || ''),
        escape(r?.reviewStartedAt || ''),
        escape(r?.reviewEndedAt || r?.reviewedAt || ''),
        escape(r?.promptSentAt || ''),
        escape(r?.promptChars ?? ''),
        escape(r?.tier ?? ''),
        escape(r?.ticketProvider ?? ''),
        escape(r?.ticketCardId ?? '')
      ].join(',');
      lines.push(line);
    }

    return lines.join('\n') + '\n';
  }

  exportJson({ lookbackHours = DEFAULT_LOOKBACK_HOURS } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
    const rows = this.taskRecordService?.list?.() || [];

    const out = [];
    for (const r of rows) {
      const updatedAtMs = parseIso(r?.updatedAt);
      if (updatedAtMs && updatedAtMs < cutoffMs) continue;
      const hasTelemetry = !!(r?.reviewStartedAt || r?.reviewEndedAt || r?.promptSentAt || r?.promptChars);
      if (!hasTelemetry) continue;

      out.push({
        id: r?.id || '',
        updatedAt: r?.updatedAt || '',
        reviewStartedAt: r?.reviewStartedAt || '',
        reviewEndedAt: r?.reviewEndedAt || r?.reviewedAt || '',
        promptSentAt: r?.promptSentAt || '',
        promptChars: r?.promptChars ?? '',
        tier: r?.tier ?? '',
        ticketProvider: r?.ticketProvider ?? '',
        ticketCardId: r?.ticketCardId ?? ''
      });
    }

    out.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

    return {
      lookbackHours: hours,
      exportedAt: new Date().toISOString(),
      records: out
    };
  }
}

module.exports = { ProcessTelemetryService };
