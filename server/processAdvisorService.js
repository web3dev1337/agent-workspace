const { TTLCache } = require('./utils/ttlCache');
const { detectCycles } = require('./taskDependencyService');

const DEFAULT_LOOKBACK_HOURS = 24;

const normalizeTier = (value) => {
  const tier = Number(value);
  return tier >= 1 && tier <= 4 ? tier : null;
};

const clampNonNegative = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return null;
  return x;
};

const normalizeRisk = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') return v;
  return '';
};

class ProcessAdvisorService {
  constructor({ processStatusService, processTelemetryService, processTaskService, taskRecordService, taskDependencyService } = {}) {
    this.processStatusService = processStatusService;
    this.processTelemetryService = processTelemetryService;
    this.processTaskService = processTaskService;
    this.taskRecordService = taskRecordService;
    this.taskDependencyService = taskDependencyService;
    this.cache = new TTLCache({ defaultTtlMs: 25_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessAdvisorService.instance) {
      ProcessAdvisorService.instance = new ProcessAdvisorService(deps);
    }
    return ProcessAdvisorService.instance;
  }

  async getAdvice({ mode = 'mine', lookbackHours = DEFAULT_LOOKBACK_HOURS, force = false } = {}) {
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const cacheKey = `advice:${mode}:${hours}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const advice = [];
      const metrics = {};
      const parseIso = (v) => {
        const ms = Date.parse(String(v || ''));
        return Number.isFinite(ms) ? ms : 0;
      };
      const nowMs = Date.now();
      const lookbackMs = Math.max(1, hours) * 60 * 60 * 1000;
      const startMs = nowMs - lookbackMs;

      const [statusRes, telemetryRes, tasksRes] = await Promise.allSettled([
        this.processStatusService?.getStatus?.({ mode, lookbackHours: hours, force }) || null,
        this.processTelemetryService?.getSummary?.({ lookbackHours: hours, force }) || null,
        this.processTaskService?.listTasks?.({ prs: { mode, state: 'open', sort: 'updated', limit: 50 } }) || []
      ]);

      const status = statusRes.status === 'fulfilled' ? statusRes.value : null;
      const telemetry = telemetryRes.status === 'fulfilled' ? telemetryRes.value : null;
      const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value : [];

      const records = typeof this.taskRecordService?.list === 'function'
        ? (this.taskRecordService.list() || [])
        : [];

      const taskById = new Map();
      for (const t of Array.isArray(tasks) ? tasks : []) {
        if (!t?.id) continue;
        taskById.set(String(t.id), t);
      }

      const labelForId = (id) => {
        const key = String(id || '').trim();
        if (!key) return '';
        const t = taskById.get(key);
        const title = String(t?.title || '').trim();
        return title || key;
      };

      const qByTier = status?.qByTier || {};
      const qCaps = status?.qCaps || {};
      const wip = Number(status?.wip || 0);
      const wipMax = Number(status?.wipMax || 0);

      metrics.lookbackHours = hours;
      metrics.wip = wip;
      metrics.wipMax = wipMax || null;
      metrics.qByTier = qByTier;

      const createdCount = Number(telemetry?.createdCount || 0);
      const doneCount = Number(telemetry?.doneCount || 0);
      metrics.createdCount = createdCount;
      metrics.doneCount = doneCount;
      metrics.netCreatedMinusDone = createdCount - doneCount;

      const telemetryOutcomeCounts = (telemetry?.outcomeCounts && typeof telemetry.outcomeCounts === 'object' && !Array.isArray(telemetry.outcomeCounts))
        ? telemetry.outcomeCounts
        : null;
      if (telemetryOutcomeCounts) metrics.telemetryOutcomeCounts = telemetryOutcomeCounts;

      if (wipMax && wip > wipMax) {
        advice.push({
          level: 'warn',
          code: 'wip_over_cap',
          title: 'Too many projects in flight',
          message: `WIP is ${wip} (cap ${wipMax}). Consider finishing/merging before starting new work.`,
          actions: [
            { type: 'ui', action: 'open-prs', label: 'Open PRs' },
            { type: 'ui', action: 'open-queue', label: 'Open Queue' }
          ]
        });
      }

      const q12 = Number(status?.q12 || 0);
      const q12Cap = Number(qCaps?.q12 || 0);
      if (q12Cap && q12 > q12Cap) {
        advice.push({
          level: 'warn',
          code: 'tier12_over_cap',
          title: 'Tier 1/2 queue overloaded',
          message: `Tier 1/2 queue is ${q12} (cap ${q12Cap}). Consider reviewing, marking done, or re-tiering tasks.`,
          actions: [
            { type: 'ui', action: 'open-prs', label: 'Open PRs' },
            { type: 'ui', action: 'queue-conveyor-t2', label: 'Conveyor T2' },
            { type: 'ui', action: 'open-queue', label: 'Open Queue' }
          ]
        });
      }

      const netBacklogGrowth = createdCount - doneCount;
      if (createdCount >= 5 && netBacklogGrowth >= 3) {
        advice.push({
          level: 'warn',
          code: 'throughput_negative',
          title: 'Backlog growing',
          message: `In the last ${hours}h, created ${createdCount} tasks but completed ${doneCount}. Consider triaging before starting new work.`,
          actions: [
            { type: 'ui', action: 'queue-triage', label: 'Open triage' },
            { type: 'ui', action: 'open-prs', label: 'Open PRs' },
            { type: 'ui', action: 'open-queue', label: 'Open Queue' }
          ]
        });
      }

      const noneCount = Number(qByTier?.none || 0);
      if (noneCount > 0) {
        advice.push({
          level: 'info',
          code: 'untagged_tasks',
          title: 'Untagged tasks',
          message: `${noneCount} queue items have no tier. Tagging tiers improves Focus/Review/Background scheduling.`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      const avgReviewSeconds = Number(telemetry?.avgReviewSeconds || 0);
      if (avgReviewSeconds && avgReviewSeconds > 10 * 60) {
        advice.push({
          level: 'info',
          code: 'review_slow',
          title: 'Reviews are taking a while',
          message: `Average review time is ~${Math.round(avgReviewSeconds / 60)} minutes. Consider running the Queue reviewer flow for Tier 3 PRs.`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      const avgVerifyMinutes = Number(telemetry?.avgVerifyMinutes || 0);
      metrics.avgVerifyMinutes = avgVerifyMinutes || null;
      if (avgVerifyMinutes && avgVerifyMinutes >= 20) {
        advice.push({
          level: 'info',
          code: 'verify_slow',
          title: 'Verification time is high',
          message: `Average verify time is ~${Math.round(avgVerifyMinutes)} minutes. Consider adding checklists, reducing scope, or increasing tier/risk on items that need heavy verification.`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      // Review outcome + trends (best-effort from task records).
      const recentReviews = records.filter((r) => {
        const ended = parseIso(r?.reviewEndedAt);
        return ended && ended >= startMs;
      });
      const recentReviewTotal = recentReviews.length;
      const recentNeedsFix = recentReviews.filter(r => String(r?.reviewOutcome || '').toLowerCase() === 'needs_fix').length;
      const recentApproved = recentReviews.filter(r => String(r?.reviewOutcome || '').toLowerCase() === 'approved').length;
      metrics.reviewsCompleted = recentReviewTotal;
      metrics.reviewsNeedsFix = recentNeedsFix;
      metrics.reviewsApproved = recentApproved;
      metrics.needsFixRate = recentReviewTotal ? (recentNeedsFix / recentReviewTotal) : 0;

      const recentReviewsSorted = recentReviews
        .slice()
        .sort((a, b) => parseIso(b?.reviewEndedAt) - parseIso(a?.reviewEndedAt));
      metrics.recentReviewTimeline = recentReviewsSorted
        .slice(0, 10)
        .map((r) => ({
          id: r?.id,
          outcome: String(r?.reviewOutcome || '').trim().toLowerCase() || null,
          endedAt: r?.reviewEndedAt || null
        }));

      if (recentReviewTotal >= 5 && metrics.needsFixRate >= 0.5) {
        const tail = recentReviewsSorted
          .slice(0, 6)
          .map(r => String(r?.reviewOutcome || '').trim().toLowerCase())
          .filter(Boolean);
        const tailText = tail.length ? ` Recent: ${tail.join(', ')}.` : '';
        advice.push({
          level: 'warn',
          code: 'needs_fix_rate_high',
          title: 'High “needs_fix” rate',
          message: `In the last ${hours}h, ${recentNeedsFix}/${recentReviewTotal} reviews ended as “needs_fix”. Consider smaller PRs, more verification time, or raising Tier on risky items.${tailText}`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      const missingVerify = recentReviews.filter((r) => {
        const outcome = String(r?.reviewOutcome || '').trim();
        if (!outcome) return false;
        const v = clampNonNegative(r?.verifyMinutes);
        return v === null;
      });
      metrics.reviewsMissingVerify = missingVerify.length;
      if (missingVerify.length >= 3) {
        const examples = missingVerify
          .slice(0, 4)
          .map(r => labelForId(r?.id))
          .filter(Boolean);
        const exampleText = examples.length ? ` Examples: ${examples.join(', ')}.` : '';
        advice.push({
          level: 'info',
          code: 'verify_missing',
          title: 'Verify minutes missing on reviews',
          message: `${missingVerify.length} reviews in the last ${hours}h are missing verifyMinutes. Filling this in helps telemetry + planning accuracy.${exampleText}`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      // Risk/tier mismatch signals (best-effort from open PR task records).
      const riskyLowTier = (Array.isArray(tasks) ? tasks : []).filter((t) => {
        if (!t || t.kind !== 'pr' || !t.id) return false;
        const record = this.taskRecordService?.get?.(t.id) || t.record || {};
        const tier = normalizeTier(record?.tier);
        if (!(tier === 1 || tier === 2)) return false;
        const risk = normalizeRisk(record?.changeRisk);
        return risk === 'high' || risk === 'critical';
      });

      metrics.riskyTier12 = riskyLowTier.length;
      if (riskyLowTier.length) {
        const examples = riskyLowTier
          .slice(0, 3)
          .map(t => labelForId(t?.id))
          .filter(Boolean);
        const exampleText = examples.length ? ` Examples: ${examples.join(', ')}.` : '';
        advice.push({
          level: 'warn',
          code: 'risky_tier12',
          title: 'High-risk items marked as Tier 1/2',
          message: `${riskyLowTier.length} open PR(s) are Tier 1/2 with changeRisk high/critical. Consider re-tiering or tightening scope before review.${exampleText}`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      const stuckReviews = records
        .filter((r) => {
          const started = parseIso(r?.reviewStartedAt);
          const ended = parseIso(r?.reviewEndedAt);
          return started && !ended && started >= startMs && (nowMs - started) > 20 * 60 * 1000;
        })
        .slice(0, 10);
      metrics.stuckReviews = stuckReviews.length;
      if (stuckReviews.length) {
        advice.push({
          level: 'info',
          code: 'review_stuck',
          title: 'Reviews left running',
          message: `${stuckReviews.length} review timer(s) have been running for >20 minutes. Stop timers or mark outcomes to keep telemetry accurate.`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      // Suggest reviewer for unreviewed Tier 3 PRs.
      const unreviewedTier3Prs = (Array.isArray(tasks) ? tasks : []).filter((t) => {
        if (t?.kind !== 'pr') return false;
        const record = this.taskRecordService?.get?.(t.id) || t.record || {};
        const tier = normalizeTier(record?.tier);
        if (tier !== 3) return false;
        return !record?.reviewedAt;
      }).slice(0, 5);

      if (unreviewedTier3Prs.length > 0) {
        advice.push({
          level: 'info',
          code: 'tier3_unreviewed_prs',
          title: 'Tier 3 PRs ready for review',
          message: `${unreviewedTier3Prs.length} Tier 3 PR(s) are unreviewed. Use “Start Review” or spawn a reviewer agent.`,
          actions: [
            { type: 'ui', action: 'queue-next', label: 'Start next review' },
            { type: 'ui', action: 'open-queue', label: 'Open Queue' }
          ]
        });
      }

      // Dependency graph signals (best-effort; bounded to small set).
      if (this.taskDependencyService && typeof this.taskDependencyService.getDependencySummary === 'function') {
        const candidates = (Array.isArray(tasks) ? tasks : [])
          .filter((t) => t?.kind === 'pr' && t?.id)
          .slice(0, 20);

        const summaries = await Promise.allSettled(candidates.map(async (t) => {
          const record = this.taskRecordService?.get?.(t.id) || t.record || {};
          const tier = normalizeTier(record?.tier);
          const summary = await this.taskDependencyService.getDependencySummary(t.id);
          return { id: t.id, tier, blocked: Number(summary?.blocked || 0), total: Number(summary?.total || 0) };
        }));

        const items = summaries
          .filter((r) => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter(Boolean);

        const blocked = items.filter(i => i.blocked > 0);
        metrics.prsBlockedByDeps = blocked.length;
        metrics.prsWithDeps = items.filter(i => i.total > 0).length;

        const tier12Blocked = blocked.filter(i => i.tier === 1 || i.tier === 2);
        if (tier12Blocked.length) {
          const top = tier12Blocked
            .slice()
            .sort((a, b) => (b.blocked - a.blocked) || (b.total - a.total))
            .slice(0, 3);

          let exampleText = '';
          if (top.length) {
            let examples = top.map(i => `${labelForId(i.id)} (${i.blocked}/${i.total})`);

            if (typeof this.taskDependencyService.resolveDependencies === 'function') {
              const resolved = await Promise.allSettled(top.map(async (i) => {
                const deps = await this.taskDependencyService.resolveDependencies(i.id);
                const blockers = (Array.isArray(deps) ? deps : [])
                  .filter((d) => d && !d.satisfied)
                  .slice(0, 2)
                  .map((d) => String(d.id || '').trim())
                  .filter(Boolean);
                return { ...i, blockers };
              }));

              examples = resolved
                .filter((r) => r.status === 'fulfilled')
                .map((r) => r.value)
                .filter(Boolean)
                .map((i) => {
                  const label = labelForId(i.id);
                  const blockers = Array.isArray(i.blockers) ? i.blockers : [];
                  if (blockers.length) return `${label} blocked by ${blockers.join(', ')}`;
                  return `${label} (${i.blocked}/${i.total})`;
                });
            }

            exampleText = examples.length ? ` Examples: ${examples.join('; ')}.` : '';
          }

          advice.push({
            level: 'warn',
            code: 'tier12_blocked',
            title: 'Tier 1/2 tasks blocked by dependencies',
            message: `${tier12Blocked.length} Tier 1/2 PR(s) are blocked by dependencies. Consider clearing blockers or re-tiering to unblock execution.${exampleText}`,
            actions: [
              { type: 'ui', action: 'queue-blockers', label: 'Show blockers' },
              { type: 'ui', action: 'open-queue', label: 'Open Queue' }
            ]
          });
        }
      }

      // Fixer/recheck loop signals (best-effort from records).
      const openNeedsFix = records.filter((r) => {
        if (r?.doneAt) return false;
        const outcome = String(r?.reviewOutcome || '').toLowerCase();
        if (outcome !== 'needs_fix') return false;
        const ended = parseIso(r?.reviewEndedAt);
        return ended && ended >= startMs;
      }).slice(0, 25);
      metrics.openNeedsFix = openNeedsFix.length;
      if (openNeedsFix.length >= 3) {
        advice.push({
          level: 'info',
          code: 'needs_fix_backlog',
          title: 'Fix backlog',
          message: `${openNeedsFix.length} items are marked “needs_fix” in the last ${hours}h. Consider spawning fixers or consolidating feedback into actionable notes.`,
          actions: [
            { type: 'ui', action: 'queue-triage', label: 'Open triage' },
            { type: 'ui', action: 'queue-next', label: 'Start next review' },
            { type: 'ui', action: 'open-queue', label: 'Open Queue' }
          ]
        });
      }

      // Dependency cycles (best-effort from local task record graph).
      try {
        const nodeIds = records.map(r => String(r?.id || '').trim()).filter(Boolean);
        const edges = [];
        for (const r of records) {
          const from = String(r?.id || '').trim();
          if (!from) continue;
          const deps = Array.isArray(r?.dependencies) ? r.dependencies : [];
          for (const dep of deps) {
            const to = String(dep || '').trim();
            if (!to) continue;
            edges.push({ from, to });
          }
        }
        const cycles = detectCycles({ nodeIds, edges, limit: 5 });
        metrics.depCycleCount = cycles.length;
        if (cycles.length) {
          const cycleText = cycles
            .slice(0, 2)
            .map(c => (Array.isArray(c) ? c.map(id => labelForId(id)).join(' → ') : ''))
            .filter(Boolean)
            .join(' • ');
          const exampleText = cycleText ? ` Example: ${cycleText}.` : '';
          advice.push({
            level: 'warn',
            code: 'dep_cycles',
            title: 'Dependency cycles detected',
            message: `Found ${cycles.length} dependency cycle(s) in task records. Cycles block progress; consider removing or re-scoping dependencies.${exampleText}`,
            actions: [
              { type: 'ui', action: 'queue-blockers', label: 'Show blockers' },
              { type: 'ui', action: 'open-queue', label: 'Open Queue' }
            ]
          });
        }
      } catch {
        // ignore
      }

      return {
        generatedAt: new Date().toISOString(),
        mode,
        lookbackHours: hours,
        metrics,
        advice
      };
    }, { force });
  }
}

module.exports = { ProcessAdvisorService };
