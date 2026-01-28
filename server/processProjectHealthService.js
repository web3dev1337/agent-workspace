const { parsePrTaskId } = require('./taskDependencyService');
const { TTLCache } = require('./utils/ttlCache');

const DEFAULT_LOOKBACK_HOURS = 24 * 14;
const DEFAULT_BUCKET_MINUTES = 24 * 60;

const parseIso = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
};

const normalizeTier = (value) => {
  const tier = Number(value);
  return tier >= 1 && tier <= 4 ? tier : null;
};

const normalizeRisk = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') return v;
  return '';
};

const avg = (arr) => {
  const values = (Array.isArray(arr) ? arr : []).filter((n) => Number.isFinite(Number(n)));
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
};

const p50 = (arr) => {
  const values = (Array.isArray(arr) ? arr : []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2) return values[mid];
  return (values[mid - 1] + values[mid]) / 2;
};

class ProcessProjectHealthService {
  constructor({ taskRecordService } = {}) {
    this.taskRecordService = taskRecordService;
    this.cache = new TTLCache({ defaultTtlMs: 25_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessProjectHealthService.instance) {
      ProcessProjectHealthService.instance = new ProcessProjectHealthService(deps);
    }
    return ProcessProjectHealthService.instance;
  }

  getHealth({ lookbackHours = DEFAULT_LOOKBACK_HOURS, bucketMinutes = DEFAULT_BUCKET_MINUTES, limit = 60, force = false } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const bucket = Number(bucketMinutes) || DEFAULT_BUCKET_MINUTES;
    const safeBucket = Math.max(15, Math.min(24 * 60, Math.round(bucket)));
    const safeLimit = Math.max(5, Math.min(200, Number(limit) || 60));
    const cacheKey = `project_health:${hours}:${safeBucket}:${safeLimit}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const nowMs = Date.now();
      const cutoffMs = nowMs - Math.max(1, hours) * 60 * 60 * 1000;
      const bucketMs = safeBucket * 60 * 1000;
      const bucketKeyFor = (t) => Math.floor(t / bucketMs) * bucketMs;

      const rows = this.taskRecordService?.list?.() || [];
      const byRepo = new Map();

      const ensure = (repoSlug) => {
        const key = String(repoSlug || '').trim();
        if (!key) return null;
        if (!byRepo.has(key)) {
          byRepo.set(key, {
            repo: key,
            openBacklog: 0,
            openRiskCounts: { low: 0, medium: 0, high: 0, critical: 0, none: 0 },
            openTierCounts: { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 },
            totals: {
              lookbackHours: hours,
              bucketMinutes: safeBucket,
              createdCount: 0,
              mergedCount: 0,
              doneCount: 0,
              reviewedCount: 0,
              needsFixCount: 0,
              avgCycleHours: null,
              p50CycleHours: null
            },
            seriesBuckets: new Map(), // t -> { createdCount, mergedCount, reviewedCount, needsFixCount, cycleHours:[] }
            cycleHoursAll: []
          });
        }
        return byRepo.get(key);
      };

      const bumpBucket = (agg, t, field) => {
        const key = bucketKeyFor(t);
        if (!agg.seriesBuckets.has(key)) {
          agg.seriesBuckets.set(key, { t: key, createdCount: 0, mergedCount: 0, doneCount: 0, reviewedCount: 0, needsFixCount: 0, cycleHours: [] });
        }
        const b = agg.seriesBuckets.get(key);
        b[field] += 1;
      };

      for (const r of rows) {
        const parsed = parsePrTaskId(r?.id);
        if (!parsed) continue;
        const repoSlug = `${parsed.owner}/${parsed.repo}`;
        const agg = ensure(repoSlug);
        if (!agg) continue;

        const createdAtMs = parseIso(r?.createdAt);
        const mergedAtMs = parseIso(r?.prMergedAt);
        const doneAtMs = parseIso(r?.doneAt);
        const reviewedAtMs = parseIso(r?.reviewEndedAt || r?.reviewedAt);
        const outcome = String(r?.reviewOutcome || '').trim().toLowerCase();

        const isOpen = !mergedAtMs && !doneAtMs;
        if (isOpen) {
          agg.openBacklog += 1;
          const tier = normalizeTier(r?.tier);
          if (tier) agg.openTierCounts[tier] += 1;
          else agg.openTierCounts.none += 1;

          const risk = normalizeRisk(r?.changeRisk);
          if (risk) agg.openRiskCounts[risk] += 1;
          else agg.openRiskCounts.none += 1;
        }

        if (createdAtMs && createdAtMs >= cutoffMs) {
          agg.totals.createdCount += 1;
          bumpBucket(agg, createdAtMs, 'createdCount');
        }

        if (mergedAtMs && mergedAtMs >= cutoffMs) {
          agg.totals.mergedCount += 1;
          bumpBucket(agg, mergedAtMs, 'mergedCount');
          if (createdAtMs && createdAtMs <= mergedAtMs) {
            const cycleHours = (mergedAtMs - createdAtMs) / (1000 * 60 * 60);
            if (Number.isFinite(cycleHours) && cycleHours >= 0) {
              agg.cycleHoursAll.push(cycleHours);
              const key = bucketKeyFor(mergedAtMs);
              if (!agg.seriesBuckets.has(key)) {
                agg.seriesBuckets.set(key, { t: key, createdCount: 0, mergedCount: 0, doneCount: 0, reviewedCount: 0, needsFixCount: 0, cycleHours: [] });
              }
              agg.seriesBuckets.get(key).cycleHours.push(cycleHours);
            }
          }
        }

        if (doneAtMs && doneAtMs >= cutoffMs) {
          agg.totals.doneCount += 1;
          bumpBucket(agg, doneAtMs, 'doneCount');
        }

        if (reviewedAtMs && reviewedAtMs >= cutoffMs) {
          agg.totals.reviewedCount += 1;
          bumpBucket(agg, reviewedAtMs, 'reviewedCount');
          if (outcome === 'needs_fix') {
            agg.totals.needsFixCount += 1;
            bumpBucket(agg, reviewedAtMs, 'needsFixCount');
          }
        }
      }

      const repos = Array.from(byRepo.values()).map((agg) => {
        agg.totals.avgCycleHours = avg(agg.cycleHoursAll);
        agg.totals.p50CycleHours = p50(agg.cycleHoursAll);

        const series = Array.from(agg.seriesBuckets.values())
          .sort((a, b) => a.t - b.t)
          .map((b) => ({
            t: b.t,
            createdCount: b.createdCount,
            mergedCount: b.mergedCount,
            doneCount: b.doneCount,
            reviewedCount: b.reviewedCount,
            needsFixCount: b.needsFixCount,
            avgCycleHours: avg(b.cycleHours)
          }));

        const { seriesBuckets, cycleHoursAll, ...rest } = agg;
        return { ...rest, series };
      });

      repos.sort((a, b) => {
        if (b.openBacklog !== a.openBacklog) return b.openBacklog - a.openBacklog;
        if (b.totals.mergedCount !== a.totals.mergedCount) return b.totals.mergedCount - a.totals.mergedCount;
        if (b.totals.createdCount !== a.totals.createdCount) return b.totals.createdCount - a.totals.createdCount;
        return String(a.repo).localeCompare(String(b.repo));
      });

      const limited = repos.slice(0, safeLimit);
      const totals = limited.reduce((acc, r) => {
        acc.repos += 1;
        acc.openBacklog += Number(r.openBacklog || 0);
        acc.createdCount += Number(r.totals?.createdCount || 0);
        acc.mergedCount += Number(r.totals?.mergedCount || 0);
        acc.needsFixCount += Number(r.totals?.needsFixCount || 0);
        return acc;
      }, { repos: 0, openBacklog: 0, createdCount: 0, mergedCount: 0, needsFixCount: 0 });

      return {
        generatedAt: new Date().toISOString(),
        lookbackHours: hours,
        bucketMinutes: safeBucket,
        totals,
        repos: limited
      };
    }, { force });
  }
}

module.exports = { ProcessProjectHealthService };

