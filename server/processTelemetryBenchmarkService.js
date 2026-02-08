const { collectFirstRunDiagnostics } = require('./diagnosticsService');

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_BUCKET_MINUTES = 60;

const clamp = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const asFinite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeLabel = (value, fallback = null) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text) return text.slice(0, 120);
  return fallback;
};

const formatDateLabel = (iso) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return 'snapshot';
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

class ProcessTelemetryBenchmarkService {
  constructor({
    processTelemetryService,
    processStatusService,
    telemetrySnapshotService,
    firstRunCollector
  } = {}) {
    this.processTelemetryService = processTelemetryService;
    this.processStatusService = processStatusService;
    this.telemetrySnapshotService = telemetrySnapshotService;
    this.firstRunCollector = firstRunCollector || collectFirstRunDiagnostics;
  }

  static getInstance(deps = {}) {
    if (!ProcessTelemetryBenchmarkService.instance) {
      ProcessTelemetryBenchmarkService.instance = new ProcessTelemetryBenchmarkService(deps);
    }
    return ProcessTelemetryBenchmarkService.instance;
  }

  _normalizeWindow({ lookbackHours, bucketMinutes } = {}) {
    const safeLookbackHours = clamp(Math.round(asFinite(lookbackHours, DEFAULT_LOOKBACK_HOURS)), 1, 24 * 30);
    const safeBucketMinutes = clamp(Math.round(asFinite(bucketMinutes, DEFAULT_BUCKET_MINUTES)), 5, 24 * 60);
    return { lookbackHours: safeLookbackHours, bucketMinutes: safeBucketMinutes };
  }

  _computeMetrics({ telemetry, status, firstRun }) {
    const firstRunSummary = firstRun?.summary || {};
    const blockingCount = asFinite(firstRunSummary.blockingCount, 0);
    const warningCount = asFinite(firstRunSummary.warningCount, 0);
    const repairableCount = asFinite(firstRunSummary.repairableCount, 0);
    const onboardingScore = clamp(100 - (blockingCount * 30) - (warningCount * 6), 0, 100);

    const runtimeWip = asFinite(status?.wip, 0);
    const runtimeWipMax = Math.max(1, asFinite(status?.wipMax, 1));
    const runtimeUtilization = runtimeWip / runtimeWipMax;
    const runtimePenalty = runtimeUtilization > 1 ? (runtimeUtilization - 1) * 35 : 0;
    const levelPenalty = String(status?.level || 'ok').toLowerCase() === 'warn' ? 15 : 0;
    const runtimeScore = clamp(100 - runtimePenalty - levelPenalty, 0, 100);
    const fourQueues = status?.fourQueues || {};
    const reviewQueueCount = asFinite(fourQueues?.review?.count, 0);
    const reworkQueueCount = asFinite(fourQueues?.rework?.count, 0);

    const reviewSeconds = asFinite(telemetry?.avgReviewSeconds, 0);
    const reviewOutcomeCounts = telemetry?.outcomeCounts || {};
    const approved = asFinite(reviewOutcomeCounts.approved, 0);
    const needsFix = asFinite(reviewOutcomeCounts.needs_fix, 0);
    const reviewedTotal = asFinite(telemetry?.reviewedCount, 0);
    const reviewSignal = reviewedTotal > 0 ? Math.min(1, reviewedTotal / 25) : 0;
    const needsFixRate = reviewedTotal > 0 ? needsFix / reviewedTotal : 0;
    const cyclePenalty = reviewSeconds > 0 ? Math.min(40, reviewSeconds / 90) : 0;
    const qualityPenalty = needsFixRate * 35;
    const reviewScore = clamp((100 - cyclePenalty - qualityPenalty) * (0.5 + (reviewSignal * 0.5)), 0, 100);

    return {
      onboarding: {
        score: Math.round(onboardingScore),
        ready: !!firstRunSummary.ready,
        blockingCount,
        warningCount,
        repairableCount
      },
      runtime: {
        score: Math.round(runtimeScore),
        level: String(status?.level || 'ok').toLowerCase(),
        wip: runtimeWip,
        wipMax: runtimeWipMax,
        utilization: Number(runtimeUtilization.toFixed(3)),
        reviewQueueCount,
        reworkQueueCount
      },
      review: {
        score: Math.round(reviewScore),
        avgReviewSeconds: reviewSeconds > 0 ? Math.round(reviewSeconds) : null,
        doneCount: asFinite(telemetry?.doneCount, 0),
        prMergedCount: asFinite(telemetry?.prMergedCount, 0),
        reviewedCount: reviewedTotal,
        approvedCount: approved,
        needsFixCount: needsFix,
        needsFixRate: Number(needsFixRate.toFixed(4))
      }
    };
  }

  _toSnapshotRow(payload) {
    if (!payload || payload.kind !== 'telemetry_benchmark') return null;

    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const params = payload.params && typeof payload.params === 'object' ? payload.params : {};
    const metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : null;
    if (!metrics) return null;

    const createdAt = String(payload.createdAt || data.generatedAt || '').trim();
    const label = normalizeLabel(data.label, null)
      || normalizeLabel(params.label, null)
      || `snapshot ${formatDateLabel(createdAt)}`;

    return {
      id: String(payload.id || '').trim(),
      createdAt,
      label,
      lookbackHours: asFinite(params.lookbackHours, DEFAULT_LOOKBACK_HOURS),
      bucketMinutes: asFinite(params.bucketMinutes, DEFAULT_BUCKET_MINUTES),
      notes: normalizeLabel(params.notes, ''),
      metrics,
      statusSummary: data.statusSummary || {},
      firstRunSummary: data.firstRunSummary || {},
      telemetrySummary: data.telemetrySummary || {}
    };
  }

  _addDeltas(rows) {
    const out = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const prev = rows[index + 1] || null;
      const delta = prev ? {
        onboardingScore: asFinite(row?.metrics?.onboarding?.score, 0) - asFinite(prev?.metrics?.onboarding?.score, 0),
        runtimeScore: asFinite(row?.metrics?.runtime?.score, 0) - asFinite(prev?.metrics?.runtime?.score, 0),
        reviewScore: asFinite(row?.metrics?.review?.score, 0) - asFinite(prev?.metrics?.review?.score, 0),
        avgReviewSeconds: asFinite(row?.metrics?.review?.avgReviewSeconds, 0) - asFinite(prev?.metrics?.review?.avgReviewSeconds, 0),
        doneCount: asFinite(row?.metrics?.review?.doneCount, 0) - asFinite(prev?.metrics?.review?.doneCount, 0),
        prMergedCount: asFinite(row?.metrics?.review?.prMergedCount, 0) - asFinite(prev?.metrics?.review?.prMergedCount, 0)
      } : null;
      out.push({ ...row, deltaFromPrevious: delta });
    }
    return out;
  }

  async _collectLiveRow({ lookbackHours, bucketMinutes, force = false } = {}) {
    const telemetry = await this.processTelemetryService.getDetails({ lookbackHours, bucketMinutes, force });
    const status = await this.processStatusService.getStatus({ lookbackHours, force });
    const firstRun = await this.firstRunCollector();
    const metrics = this._computeMetrics({ telemetry, status, firstRun });
    const generatedAt = new Date().toISOString();

    return {
      id: 'live',
      createdAt: generatedAt,
      label: 'live',
      lookbackHours: asFinite(telemetry?.lookbackHours, lookbackHours),
      bucketMinutes: asFinite(telemetry?.bucketMinutes, bucketMinutes),
      notes: '',
      metrics,
      statusSummary: {
        level: String(status?.level || 'ok').toLowerCase(),
        wip: asFinite(status?.wip, 0),
        wipMax: asFinite(status?.wipMax, 0)
      },
      firstRunSummary: firstRun?.summary || {},
      telemetrySummary: {
        reviewedCount: asFinite(telemetry?.reviewedCount, 0),
        doneCount: asFinite(telemetry?.doneCount, 0),
        prMergedCount: asFinite(telemetry?.prMergedCount, 0),
        avgReviewSeconds: asFinite(telemetry?.avgReviewSeconds, 0)
      }
    };
  }

  async captureSnapshot({ label, notes = '', lookbackHours, bucketMinutes } = {}) {
    const window = this._normalizeWindow({ lookbackHours, bucketMinutes });
    const live = await this._collectLiveRow({ ...window, force: true });
    const normalizedLabel = normalizeLabel(label, `snapshot ${formatDateLabel(live.createdAt)}`);

    const created = await this.telemetrySnapshotService.create({
      kind: 'telemetry_benchmark',
      params: {
        label: normalizedLabel,
        notes: normalizeLabel(notes, ''),
        lookbackHours: live.lookbackHours,
        bucketMinutes: live.bucketMinutes
      },
      data: {
        label: normalizedLabel,
        generatedAt: live.createdAt,
        metrics: live.metrics,
        statusSummary: live.statusSummary,
        firstRunSummary: live.firstRunSummary,
        telemetrySummary: live.telemetrySummary
      }
    });

    return {
      id: created.id,
      createdAt: created.createdAt,
      label: normalizedLabel,
      lookbackHours: live.lookbackHours,
      bucketMinutes: live.bucketMinutes
    };
  }

  async listSnapshots({ limit = 10 } = {}) {
    const safeLimit = clamp(Math.round(asFinite(limit, 10)), 1, 50);
    const listed = this.telemetrySnapshotService.list({ limit: safeLimit * 5 });

    const rows = [];
    for (const item of listed) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      let payload = null;
      try {
        payload = await this.telemetrySnapshotService.get(id);
      } catch {
        payload = null;
      }
      const row = this._toSnapshotRow(payload);
      if (row) rows.push(row);
      if (rows.length >= safeLimit) break;
    }

    rows.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return rows.slice(0, safeLimit);
  }

  async getBenchmarkDashboard({
    lookbackHours,
    bucketMinutes,
    limit = 10,
    force = false
  } = {}) {
    const window = this._normalizeWindow({ lookbackHours, bucketMinutes });
    const [live, snapshots] = await Promise.all([
      this._collectLiveRow({ ...window, force }),
      this.listSnapshots({ limit })
    ]);

    const rows = this._addDeltas([live, ...snapshots]);
    return {
      generatedAt: new Date().toISOString(),
      lookbackHours: window.lookbackHours,
      bucketMinutes: window.bucketMinutes,
      count: rows.length,
      rows
    };
  }

  async buildReleaseNotes({
    currentId = 'live',
    baselineId = '',
    lookbackHours,
    bucketMinutes
  } = {}) {
    const window = this._normalizeWindow({ lookbackHours, bucketMinutes });
    const snapshots = await this.listSnapshots({ limit: 20 });
    const byId = new Map(snapshots.map((row) => [row.id, row]));
    const live = await this._collectLiveRow({ ...window, force: true });

    const normalizedCurrentId = String(currentId || 'live').trim() || 'live';
    const current = normalizedCurrentId === 'live' ? live : (byId.get(normalizedCurrentId) || null);
    if (!current) throw new Error('Current benchmark snapshot not found');

    const normalizedBaselineId = String(baselineId || '').trim();
    let baseline = null;
    if (normalizedBaselineId) {
      baseline = normalizedBaselineId === 'live' ? live : (byId.get(normalizedBaselineId) || null);
      if (!baseline) throw new Error('Baseline benchmark snapshot not found');
    } else if (current.id === 'live') {
      baseline = snapshots[0] || null;
    } else {
      const currentIndex = snapshots.findIndex((row) => row.id === current.id);
      baseline = currentIndex >= 0 ? (snapshots[currentIndex + 1] || snapshots[0] || null) : (snapshots[0] || null);
    }

    if (!baseline) throw new Error('No baseline benchmark snapshot available');
    if (baseline.id === current.id) throw new Error('Current and baseline snapshots must be different');

    const delta = {
      onboardingScore: asFinite(current?.metrics?.onboarding?.score, 0) - asFinite(baseline?.metrics?.onboarding?.score, 0),
      runtimeScore: asFinite(current?.metrics?.runtime?.score, 0) - asFinite(baseline?.metrics?.runtime?.score, 0),
      reviewScore: asFinite(current?.metrics?.review?.score, 0) - asFinite(baseline?.metrics?.review?.score, 0),
      avgReviewSeconds: asFinite(current?.metrics?.review?.avgReviewSeconds, 0) - asFinite(baseline?.metrics?.review?.avgReviewSeconds, 0),
      doneCount: asFinite(current?.metrics?.review?.doneCount, 0) - asFinite(baseline?.metrics?.review?.doneCount, 0),
      prMergedCount: asFinite(current?.metrics?.review?.prMergedCount, 0) - asFinite(baseline?.metrics?.review?.prMergedCount, 0)
    };

    const sign = (value) => (value > 0 ? `+${value}` : String(value));
    const formatSeconds = (value) => {
      const n = asFinite(value, 0);
      if (n <= 0) return '0s';
      if (n < 60) return `${Math.round(n)}s`;
      if (n < 3600) return `${Math.round(n / 60)}m`;
      return `${(n / 3600).toFixed(1)}h`;
    };

    const markdown = [
      '## Release telemetry benchmark',
      '',
      `- Current: ${current.label} (${current.createdAt})`,
      `- Baseline: ${baseline.label} (${baseline.createdAt})`,
      '',
      `- Onboarding score: ${current.metrics.onboarding.score} (${sign(delta.onboardingScore)} vs baseline)`,
      `- Runtime score: ${current.metrics.runtime.score} (${sign(delta.runtimeScore)} vs baseline)`,
      `- Review score: ${current.metrics.review.score} (${sign(delta.reviewScore)} vs baseline)`,
      `- Avg review cycle: ${formatSeconds(current.metrics.review.avgReviewSeconds)} (${sign(delta.avgReviewSeconds)}s vs baseline)`,
      `- Done throughput: ${current.metrics.review.doneCount} (${sign(delta.doneCount)} vs baseline)`,
      `- PR merges: ${current.metrics.review.prMergedCount} (${sign(delta.prMergedCount)} vs baseline)`
    ].join('\n');

    return { current, baseline, delta, markdown };
  }
}

module.exports = { ProcessTelemetryBenchmarkService };
