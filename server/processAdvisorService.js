const { TTLCache } = require('./utils/ttlCache');

const DEFAULT_LOOKBACK_HOURS = 24;

const normalizeTier = (value) => {
  const tier = Number(value);
  return tier >= 1 && tier <= 4 ? tier : null;
};

class ProcessAdvisorService {
  constructor({ processStatusService, processTelemetryService, processTaskService, taskRecordService } = {}) {
    this.processStatusService = processStatusService;
    this.processTelemetryService = processTelemetryService;
    this.processTaskService = processTaskService;
    this.taskRecordService = taskRecordService;
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

      const [status, telemetry, tasks] = await Promise.all([
        this.processStatusService?.getStatus?.({ mode, lookbackHours: hours, force }) || null,
        this.processTelemetryService?.getSummary?.({ lookbackHours: hours, force }) || null,
        this.processTaskService?.listTasks?.({ prs: { mode, state: 'open', sort: 'updated', limit: 50 } }) || []
      ]);

      const qByTier = status?.qByTier || {};
      const qCaps = status?.qCaps || {};
      const wip = Number(status?.wip || 0);
      const wipMax = Number(status?.wipMax || 0);

      if (wipMax && wip > wipMax) {
        advice.push({
          level: 'warn',
          code: 'wip_over_cap',
          title: 'Too many projects in flight',
          message: `WIP is ${wip} (cap ${wipMax}). Consider finishing/merging before starting new work.`,
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
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
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
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
          message: `Average review time is ~${Math.round(avgReviewSeconds / 60)} minutes. Consider using the Queue “Reviewer” button for Tier 3 PRs.`,
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
          actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
        });
      }

      return {
        generatedAt: new Date().toISOString(),
        mode,
        lookbackHours: hours,
        advice
      };
    }, { force });
  }
}

module.exports = { ProcessAdvisorService };

