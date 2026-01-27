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
      let doneCount = 0;
      let prMergedCount = 0;
      let ticketMovedCount = 0;
      let ticketClosedCount = 0;

      const reviewSeconds = [];
      const promptChars = [];
      const verifyMinutes = [];
      const outcomeCounts = { approved: 0, needs_fix: 0, commented: 0, skipped: 0, other: 0 };

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

        const doneAtMs = parseIso(r?.doneAt);
        if (doneAtMs) doneCount += 1;

        const prMergedAtMs = parseIso(r?.prMergedAt);
        if (prMergedAtMs) prMergedCount += 1;

        const ticketMovedAtMs = parseIso(r?.ticketMovedAt);
        if (ticketMovedAtMs) ticketMovedCount += 1;

        const ticketClosedAtMs = parseIso(r?.ticketClosedAt);
        if (ticketClosedAtMs) ticketClosedCount += 1;

        const vm = clampNonNegative(r?.verifyMinutes);
        if (vm !== null) verifyMinutes.push(vm);

        const outcome = String(r?.reviewOutcome || '').trim().toLowerCase();
        if (outcome === 'approved') outcomeCounts.approved += 1;
        else if (outcome === 'needs_fix') outcomeCounts.needs_fix += 1;
        else if (outcome === 'commented') outcomeCounts.commented += 1;
        else if (outcome === 'skipped') outcomeCounts.skipped += 1;
        else if (outcome) outcomeCounts.other += 1;
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
        doneCount,
        prMergedCount,
        ticketMovedCount,
        ticketClosedCount,
        avgReviewSeconds: avg(reviewSeconds),
        avgPromptChars: avg(promptChars),
        avgVerifyMinutes: avg(verifyMinutes),
        outcomeCounts,
        samples: {
          reviewSeconds: reviewSeconds.length,
          promptChars: promptChars.length,
          verifyMinutes: verifyMinutes.length
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

      const buckets = new Map(); // bucketStartMs -> { reviewSeconds:[], promptChars:[], doneCount:number }
      const allReviewSeconds = [];
      const allPromptChars = [];

      const addToBucket = (key, kind, value) => {
        if (!Number.isFinite(key)) return;
        if (!buckets.has(key)) buckets.set(key, { reviewSeconds: [], promptChars: [], doneCount: 0, prMergedCount: 0, ticketMovedCount: 0, ticketClosedCount: 0 });
        const b = buckets.get(key);
        if (kind === 'reviewSeconds') b.reviewSeconds.push(value);
        if (kind === 'promptChars') b.promptChars.push(value);
      };

      const bumpDoneBucket = (key) => {
        if (!Number.isFinite(key)) return;
        if (!buckets.has(key)) buckets.set(key, { reviewSeconds: [], promptChars: [], doneCount: 0, prMergedCount: 0, ticketMovedCount: 0, ticketClosedCount: 0 });
        const b = buckets.get(key);
        b.doneCount += 1;
      };

      const bumpBucket = (key, field) => {
        if (!Number.isFinite(key)) return;
        if (!buckets.has(key)) buckets.set(key, { reviewSeconds: [], promptChars: [], doneCount: 0, prMergedCount: 0, ticketMovedCount: 0, ticketClosedCount: 0 });
        const b = buckets.get(key);
        if (field === 'prMergedCount') b.prMergedCount += 1;
        if (field === 'ticketMovedCount') b.ticketMovedCount += 1;
        if (field === 'ticketClosedCount') b.ticketClosedCount += 1;
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

        const doneAtMs = parseIso(r?.doneAt);
        if (doneAtMs) {
          bumpDoneBucket(bucketKeyFor(doneAtMs));
        }

        const prMergedAtMs = parseIso(r?.prMergedAt);
        if (prMergedAtMs) bumpBucket(bucketKeyFor(prMergedAtMs), 'prMergedCount');

        const ticketMovedAtMs = parseIso(r?.ticketMovedAt);
        if (ticketMovedAtMs) bumpBucket(bucketKeyFor(ticketMovedAtMs), 'ticketMovedCount');

        const ticketClosedAtMs = parseIso(r?.ticketClosedAt);
        if (ticketClosedAtMs) bumpBucket(bucketKeyFor(ticketClosedAtMs), 'ticketClosedCount');
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
          avgPromptChars: avg(b.promptChars),
          doneCount: b.doneCount,
          prMergedCount: b.prMergedCount,
          ticketMovedCount: b.ticketMovedCount,
          ticketClosedCount: b.ticketClosedCount
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
      'doneAt',
      'reviewStartedAt',
      'reviewEndedAt',
      'reviewOutcome',
      'verifyMinutes',
      'promptSentAt',
      'promptChars',
      'prMergedAt',
      'ticketMovedAt',
      'ticketClosedAt',
      'tier',
      'ticketProvider',
      'ticketCardId',
      'ticketBoardId',
      'prUrl'
    ];

    const lines = [header.join(',')];
    for (const r of rows) {
      const updatedAtMs = parseIso(r?.updatedAt);
      if (updatedAtMs && updatedAtMs < cutoffMs) continue;
      const hasTelemetry = !!(
        r?.reviewStartedAt
        || r?.reviewEndedAt
        || r?.reviewedAt
        || r?.promptSentAt
        || r?.promptChars
        || r?.doneAt
        || r?.reviewOutcome
        || r?.verifyMinutes
        || r?.prMergedAt
        || r?.ticketMovedAt
        || r?.ticketClosedAt
      );
      if (!hasTelemetry) continue;

      const line = [
        escape(r?.id || ''),
        escape(r?.updatedAt || ''),
        escape(r?.doneAt || ''),
        escape(r?.reviewStartedAt || ''),
        escape(r?.reviewEndedAt || r?.reviewedAt || ''),
        escape(r?.reviewOutcome || ''),
        escape(r?.verifyMinutes ?? ''),
        escape(r?.promptSentAt || ''),
        escape(r?.promptChars ?? ''),
        escape(r?.prMergedAt || ''),
        escape(r?.ticketMovedAt || ''),
        escape(r?.ticketClosedAt || ''),
        escape(r?.tier ?? ''),
        escape(r?.ticketProvider ?? ''),
        escape(r?.ticketCardId ?? ''),
        escape(r?.ticketBoardId ?? ''),
        escape(r?.prUrl ?? '')
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
      const hasTelemetry = !!(
        r?.reviewStartedAt
        || r?.reviewEndedAt
        || r?.reviewedAt
        || r?.promptSentAt
        || r?.promptChars
        || r?.doneAt
        || r?.reviewOutcome
        || r?.verifyMinutes
        || r?.prMergedAt
        || r?.ticketMovedAt
        || r?.ticketClosedAt
      );
      if (!hasTelemetry) continue;

      out.push({
        id: r?.id || '',
        updatedAt: r?.updatedAt || '',
        doneAt: r?.doneAt || '',
        reviewStartedAt: r?.reviewStartedAt || '',
        reviewEndedAt: r?.reviewEndedAt || r?.reviewedAt || '',
        reviewOutcome: r?.reviewOutcome || '',
        verifyMinutes: r?.verifyMinutes ?? '',
        promptSentAt: r?.promptSentAt || '',
        promptChars: r?.promptChars ?? '',
        prMergedAt: r?.prMergedAt || '',
        ticketMovedAt: r?.ticketMovedAt || '',
        ticketClosedAt: r?.ticketClosedAt || '',
        tier: r?.tier ?? '',
        ticketProvider: r?.ticketProvider ?? '',
        ticketCardId: r?.ticketCardId ?? '',
        ticketBoardId: r?.ticketBoardId ?? '',
        prUrl: r?.prUrl ?? ''
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
