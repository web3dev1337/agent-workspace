const { parsePrTaskId } = require('./taskDependencyService');
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

const avg = (arr) => {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

const riskRank = (risk) => {
  const r = String(risk || '').trim().toLowerCase();
  if (r === 'critical') return 4;
  if (r === 'high') return 3;
  if (r === 'medium') return 2;
  if (r === 'low') return 1;
  return 0;
};

const extractRepoSlugFromPullRequest = (pr) => {
  const nameWithOwner = String(pr?.repository?.nameWithOwner || '').trim();
  if (nameWithOwner) return nameWithOwner;

  const owner = pr?.repository?.owner?.login || pr?.repository?.owner?.name || null;
  const name = pr?.repository?.name || null;
  if (owner && name) return `${owner}/${name}`;

  const repoSlug = String(pr?.repository || '').trim();
  if (/^[^/]+\/[^/]+$/.test(repoSlug)) return repoSlug;

  const url = String(pr?.url || '').trim();
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/i);
  if (match) return `${match[1]}/${match[2]}`;

  return null;
};

class ProcessProjectDashboardService {
  constructor({ pullRequestService, taskRecordService } = {}) {
    this.pullRequestService = pullRequestService;
    this.taskRecordService = taskRecordService;
    this.cache = new TTLCache({ defaultTtlMs: 20_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessProjectDashboardService.instance) {
      ProcessProjectDashboardService.instance = new ProcessProjectDashboardService(deps);
    }
    return ProcessProjectDashboardService.instance;
  }

  async getSummary({ mode = 'mine', lookbackHours = DEFAULT_LOOKBACK_HOURS, limit = 80, force = false } = {}) {
    const normalizedMode = String(mode || 'mine').trim().toLowerCase();
    const hours = Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS;
    const safeLimit = Math.max(10, Math.min(200, Number(limit) || 80));
    const cacheKey = `projects:${normalizedMode}:${hours}:${safeLimit}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

      const prsResult = await this.pullRequestService.searchPullRequests({
        mode: normalizedMode,
        state: 'open',
        sort: 'updated',
        limit: safeLimit,
        query: ''
      });

      const prs = Array.isArray(prsResult?.prs) ? prsResult.prs : [];

      const recordsById = new Map();
      if (this.taskRecordService?.get) {
        for (const pr of prs) {
          const repoSlug = extractRepoSlugFromPullRequest(pr);
          const id = repoSlug && pr?.number ? `pr:${repoSlug}#${pr.number}` : null;
          if (!id) continue;
          // eslint-disable-next-line no-await-in-loop
          const rec = await Promise.resolve(this.taskRecordService.get(id)).catch(() => null);
          if (rec) recordsById.set(id, rec);
        }
      }

      const byRepo = new Map();

      for (const pr of prs) {
        const repoSlug = extractRepoSlugFromPullRequest(pr);
        if (!repoSlug) continue;

        const prId = pr?.number ? `pr:${repoSlug}#${pr.number}` : null;
        if (!prId) continue;

        const rec = recordsById.get(prId) || null;
        const tier = Number(rec?.tier);
        const changeRisk = String(rec?.changeRisk || '').trim().toLowerCase() || null;
        const reviewed = !!rec?.reviewedAt;
        const reviewOutcome = String(rec?.reviewOutcome || '').trim().toLowerCase() || null;
        const isDraft = !!pr?.isDraft;

        if (!byRepo.has(repoSlug)) {
          byRepo.set(repoSlug, {
            repo: repoSlug,
            prsOpen: 0,
            prsDraft: 0,
            prsUnreviewed: 0,
            prsNeedsFix: 0,
            prsReviewing: 0,
            tierCounts: { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 },
            riskCounts: { low: 0, medium: 0, high: 0, critical: 0, none: 0 },
            telemetry: {
              lookbackHours: hours,
              samples: { reviewSeconds: 0, promptChars: 0 },
              avgReviewSeconds: null,
              avgPromptChars: null
            },
            prs: []
          });
        }

        const agg = byRepo.get(repoSlug);
        agg.prsOpen += 1;
        if (isDraft) agg.prsDraft += 1;
        if (!reviewed) agg.prsUnreviewed += 1;
        if (reviewOutcome === 'needs_fix') agg.prsNeedsFix += 1;

        const reviewing = !!(rec?.reviewStartedAt && !rec?.reviewEndedAt && !rec?.reviewedAt);
        if (reviewing) agg.prsReviewing += 1;

        if (tier >= 1 && tier <= 4) agg.tierCounts[tier] += 1;
        else agg.tierCounts.none += 1;

        const rr = riskRank(changeRisk);
        if (rr === 1) agg.riskCounts.low += 1;
        else if (rr === 2) agg.riskCounts.medium += 1;
        else if (rr === 3) agg.riskCounts.high += 1;
        else if (rr === 4) agg.riskCounts.critical += 1;
        else agg.riskCounts.none += 1;

        const updatedAt = pr?.updatedAt || pr?.createdAt || null;
        agg.prs.push({
          id: prId,
          number: pr?.number || null,
          title: pr?.title || null,
          url: pr?.url || null,
          updatedAt,
          isDraft,
          record: rec ? {
            tier: rec?.tier ?? null,
            changeRisk: rec?.changeRisk ?? null,
            reviewedAt: rec?.reviewedAt ?? null,
            reviewOutcome: rec?.reviewOutcome ?? null,
            reviewStartedAt: rec?.reviewStartedAt ?? null,
            reviewEndedAt: rec?.reviewEndedAt ?? null,
            promptSentAt: rec?.promptSentAt ?? null,
            promptChars: rec?.promptChars ?? null
          } : null
        });
      }

      // Telemetry by repo (from task records) based on pr:<repo># ids.
      const rows = this.taskRecordService?.list?.() || [];
      const reviewsByRepo = new Map();
      const promptCharsByRepo = new Map();

      for (const r of rows) {
        const parsed = parsePrTaskId(r?.id);
        if (!parsed) continue;
        const repoSlug = `${parsed.owner}/${parsed.repo}`;
        const updatedAtMs = parseIso(r?.updatedAt);
        if (updatedAtMs && updatedAtMs < cutoffMs) continue;

        const startMs = parseIso(r?.reviewStartedAt);
        const endMs = parseIso(r?.reviewEndedAt || r?.reviewedAt);
        if (startMs && endMs && endMs >= startMs) {
          const seconds = (endMs - startMs) / 1000;
          if (seconds >= 0 && seconds <= hours * 60 * 60) {
            if (!reviewsByRepo.has(repoSlug)) reviewsByRepo.set(repoSlug, []);
            reviewsByRepo.get(repoSlug).push(seconds);
          }
        }

        const ps = parseIso(r?.promptSentAt);
        if (ps) {
          const pc = clampNonNegative(r?.promptChars);
          if (pc !== null) {
            if (!promptCharsByRepo.has(repoSlug)) promptCharsByRepo.set(repoSlug, []);
            promptCharsByRepo.get(repoSlug).push(pc);
          }
        }
      }

      const repos = Array.from(byRepo.values());
      for (const repo of repos) {
        const rev = reviewsByRepo.get(repo.repo) || [];
        const pcs = promptCharsByRepo.get(repo.repo) || [];
        repo.telemetry.samples.reviewSeconds = rev.length;
        repo.telemetry.samples.promptChars = pcs.length;
        repo.telemetry.avgReviewSeconds = avg(rev);
        repo.telemetry.avgPromptChars = avg(pcs);

        // Keep only a small set of PR rows for dashboard rendering (most recently updated).
        repo.prs.sort((a, b) => (parseIso(b.updatedAt) - parseIso(a.updatedAt)));
        repo.prs = repo.prs.slice(0, 6);
      }

      repos.sort((a, b) => {
        // Primary: unreviewed desc, then total open desc, then repo name.
        if (b.prsUnreviewed !== a.prsUnreviewed) return b.prsUnreviewed - a.prsUnreviewed;
        if (b.prsOpen !== a.prsOpen) return b.prsOpen - a.prsOpen;
        return String(a.repo).localeCompare(String(b.repo));
      });

      const totals = repos.reduce((acc, r) => {
        acc.repos += 1;
        acc.prsOpen += r.prsOpen;
        acc.prsUnreviewed += r.prsUnreviewed;
        acc.prsNeedsFix += r.prsNeedsFix;
        return acc;
      }, { repos: 0, prsOpen: 0, prsUnreviewed: 0, prsNeedsFix: 0 });

      return {
        mode: normalizedMode,
        lookbackHours: hours,
        totals,
        repos
      };
    }, { force });
  }
}

module.exports = { ProcessProjectDashboardService };
