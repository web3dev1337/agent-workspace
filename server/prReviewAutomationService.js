'use strict';

const path = require('path');
const winston = require('winston');
const { collectDiagnostics } = require('./diagnosticsService');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'pr-review-automation.log'), maxsize: 5_000_000, maxFiles: 3 })
  ]
});

const CONFIG_PATH = 'global.ui.tasks.automations.prReview';
const AGENT_CLI_CACHE_TTL_MS = 30_000;

const normalizeOptionalCliValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === 'default' || normalized === 'latest') return undefined;
  return raw;
};

const normalizeReviewerMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'resume') {
    // Automated reviewer/fixer spawns do not have a resume id, so picker-style
    // resume would block the workflow instead of launching directly.
    return 'continue';
  }
  return raw === 'continue' || raw === 'fresh' ? raw : 'fresh';
};

const normalizeReviewerPostAction = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return s === 'auto_fix' || s === 'auto-fix' ? 'auto_fix' : 'feedback';
};

const normalizeDeliveryAction = (value, fallback = 'notify') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'paste_and_notify' || raw === 'paste-and-notify') return 'paste_and_notify';
  if (raw === 'paste' || raw === 'notify' || raw === 'none') return raw;
  return fallback;
};

const normalizeAgentId = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'codex' ? 'codex' : 'claude';
};

const summarizeReviewBody = (value) => {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '';

  const picked = [];
  for (const line of lines) {
    if (picked.join('\n').length >= 1200) break;
    picked.push(line);
    if (picked.length >= 8) break;
  }

  return picked.join('\n').slice(0, 1200);
};

const DEFAULT_CONFIG = {
  enabled: false,
  pollEnabled: true,
  pollMs: 60_000,
  webhookEnabled: true,
  reviewerAgent: 'claude',
  reviewerMode: 'fresh',
  reviewerProvider: 'anthropic',
  reviewerClaudeModel: '',
  reviewerSkipPermissions: true,
  reviewerCodexModel: '',
  reviewerCodexReasoning: '',
  reviewerCodexVerbosity: '',
  reviewerCodexFlags: ['yolo'],
  reviewerTier: 3,
  autoSpawnReviewer: true,
  autoFeedbackToAuthor: true,
  autoSpawnFixer: false,
  notifyOnReviewerSpawn: true,
  notifyOnReviewCompleted: true,
  approvedDeliveryAction: 'notify',
  commentedDeliveryAction: 'notify',
  needsFixFeedbackAction: 'paste_and_notify',
  maxConcurrentReviewers: 3,
  repos: []
};

class PrReviewAutomationService {
  constructor(deps = {}) {
    this.taskRecordService = deps.taskRecordService || null;
    this.pullRequestService = deps.pullRequestService || null;
    this.userSettingsService = deps.userSettingsService || null;
    this.sessionManager = deps.sessionManager || null;
    this.workspaceManager = deps.workspaceManager || null;
    this.ensureWorkspaceMixedWorktree = deps.ensureWorkspaceMixedWorktree || null;
    this.io = deps.io || null;
    this.collectDiagnostics = deps.collectDiagnostics || collectDiagnostics;

    this.lastPollAt = null;
    this.activeReviewers = new Map();
    this.processedPrKeys = new Set();
    this.activeFixers = new Map();
    this.pollTimer = null;
    this.agentCliAvailabilityCache = {
      at: 0,
      value: null
    };
  }

  static getInstance(deps = {}) {
    if (!PrReviewAutomationService.instance) {
      PrReviewAutomationService.instance = new PrReviewAutomationService(deps);
    }
    return PrReviewAutomationService.instance;
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  getConfig() {
    const settings = this.userSettingsService?.getAllSettings?.() || {};
    const auto = settings?.global?.ui?.tasks?.automations?.prReview;
    return { ...DEFAULT_CONFIG, ...(auto && typeof auto === 'object' ? auto : {}) };
  }

  updateConfig(patch = {}) {
    if (!this.userSettingsService || typeof this.userSettingsService.updateGlobalSettings !== 'function') {
      throw new Error('userSettingsService not available');
    }
    const settings = this.userSettingsService.getAllSettings() || {};
    const global = settings?.global || {};
    const ui = global.ui || {};
    const tasks = ui.tasks || {};
    const automations = tasks.automations || {};
    const current = this.getConfig();
    const next = { ...current, ...patch };
    automations.prReview = next;
    tasks.automations = automations;
    ui.tasks = tasks;
    global.ui = ui;
    const ok = this.userSettingsService.updateGlobalSettings(global);
    if (!ok) throw new Error('Failed to persist prReview config');
    return next;
  }

  _resolveReviewerConfig(cfg = {}) {
    const rawAgent = String(cfg.reviewerAgent || 'claude').trim().toLowerCase();
    const agentId = rawAgent === 'codex' ? 'codex' : 'claude';
    const mode = normalizeReviewerMode(cfg.reviewerMode || 'fresh');

    if (agentId === 'codex') {
      const model = normalizeOptionalCliValue(cfg.reviewerCodexModel);

      const reasoningRaw = String(cfg.reviewerCodexReasoning || '').trim().toLowerCase();
      const reasoning = (reasoningRaw === 'low' || reasoningRaw === 'medium' || reasoningRaw === 'high' || reasoningRaw === 'xhigh')
        ? reasoningRaw
        : undefined;

      const verbosityRaw = String(cfg.reviewerCodexVerbosity || '').trim().toLowerCase();
      const verbosity = (verbosityRaw === 'low' || verbosityRaw === 'medium' || verbosityRaw === 'high')
        ? verbosityRaw
        : undefined;

      const providedFlags = Array.isArray(cfg.reviewerCodexFlags) ? cfg.reviewerCodexFlags : [];
      const validFlags = new Set(['yolo', 'workspaceWrite', 'readOnly', 'neverAsk', 'askOnRequest']);
      const flags = providedFlags
        .map((f) => String(f || '').trim())
        .filter((f) => validFlags.has(f));

      return {
        agentId,
        mode,
        model,
        reasoning,
        verbosity,
        flags: flags.length ? [...new Set(flags)] : ['yolo']
      };
    }

    const provider = String(cfg.reviewerProvider || 'anthropic').trim() || 'anthropic';
    const model = normalizeOptionalCliValue(cfg.reviewerClaudeModel);
    const reviewerSkipPermissions = cfg.reviewerSkipPermissions === undefined ? true : !!cfg.reviewerSkipPermissions;

    return {
      agentId,
      mode,
      provider,
      model,
      flags: reviewerSkipPermissions ? ['skipPermissions'] : []
    };
  }

  async _getInstalledAgentCliAvailability() {
    const now = Date.now();
    if (this.agentCliAvailabilityCache.value && (now - this.agentCliAvailabilityCache.at) < AGENT_CLI_CACHE_TTL_MS) {
      return this.agentCliAvailabilityCache.value;
    }

    const diagnostics = await this.collectDiagnostics();
    const tools = Array.isArray(diagnostics?.tools) ? diagnostics.tools : [];
    const availability = {
      claude: tools.some((tool) => tool?.id === 'claude' && !!tool?.ok),
      codex: tools.some((tool) => tool?.id === 'codex' && !!tool?.ok)
    };

    this.agentCliAvailabilityCache = {
      at: now,
      value: availability
    };
    return availability;
  }

  async _resolveRunnableReviewerConfig(cfg = {}) {
    const requested = this._resolveReviewerConfig(cfg);
    try {
      const availability = await this._getInstalledAgentCliAvailability();
      if (availability[requested.agentId]) {
        return requested;
      }

      const fallbackAgentId = requested.agentId === 'codex' ? 'claude' : 'codex';
      if (availability[fallbackAgentId]) {
        logger.warn('Requested reviewer agent CLI unavailable; falling back to installed alternative', {
          requestedAgent: requested.agentId,
          fallbackAgent: fallbackAgentId
        });
        return this._resolveReviewerConfig({ ...cfg, reviewerAgent: fallbackAgentId });
      }

      logger.warn('No supported reviewer agent CLI is installed', {
        requestedAgent: requested.agentId,
        availability
      });
      return null;
    } catch (error) {
      logger.warn('Failed to detect reviewer agent CLI availability; using requested agent config', {
        requestedAgent: requested.agentId,
        error: error.message
      });
      return requested;
    }
  }

  _resolvePostReviewAction(prId, cfg = {}) {
    const record = this.taskRecordService?.get?.(prId) || null;
    if (record?.reviewerPostAction) {
      return normalizeReviewerPostAction(record.reviewerPostAction);
    }

    if (cfg.autoFeedbackToAuthor) return 'feedback';
    if (cfg.autoSpawnFixer) return 'auto_fix';

    return 'feedback';
  }

  _resolveOutcomeDeliveryAction(outcome, cfg = {}) {
    const key = String(outcome || '').trim().toLowerCase();
    if (key === 'approved') {
      return normalizeDeliveryAction(cfg.approvedDeliveryAction, 'notify');
    }
    if (key === 'commented') {
      return normalizeDeliveryAction(cfg.commentedDeliveryAction, 'notify');
    }
    return normalizeDeliveryAction(cfg.needsFixFeedbackAction, 'paste_and_notify');
  }

  _inferReviewerAgent(prId, reviewInfo = {}, cfg = {}) {
    const active = this.activeReviewers.get(prId) || null;
    const fromSession = String(active?.sessionId || '').trim().toLowerCase();
    if (fromSession.endsWith('-codex')) return 'codex';
    if (fromSession.endsWith('-claude')) return 'claude';

    const record = this.taskRecordService?.get?.(prId) || null;
    const stored = String(record?.reviewerAgent || '').trim().toLowerCase();
    if (stored === 'codex' || stored === 'claude') return stored;

    const latest = String(reviewInfo?.latestReviewAgent || '').trim().toLowerCase();
    if (latest === 'codex' || latest === 'claude') return latest;

    return normalizeAgentId(cfg.reviewerAgent || 'claude');
  }

  _buildReviewSnapshot(prId, reviewInfo = {}, outcome, cfg = {}) {
    const reviewBody = String(reviewInfo?.reviewBody || '').trim();
    const reviewSummary = summarizeReviewBody(reviewBody) || '(No detailed comments)';
    return {
      latestReviewBody: reviewBody || null,
      latestReviewSummary: reviewSummary,
      latestReviewOutcome: outcome || null,
      latestReviewUser: String(reviewInfo?.reviewUser || '').trim() || null,
      latestReviewUrl: String(reviewInfo?.reviewUrl || reviewInfo?.url || '').trim() || null,
      latestReviewSubmittedAt: reviewInfo?.reviewSubmittedAt || new Date().toISOString(),
      latestReviewAgent: this._inferReviewerAgent(prId, reviewInfo, cfg)
    };
  }

  _buildReviewFeedbackMessage(prId, reviewInfo = {}, outcome) {
    const { number } = this._getPrIdentityFromId(prId);
    const normalizedOutcome = String(outcome || '').trim().toLowerCase();
    const outcomeLabel = normalizedOutcome === 'approved'
      ? 'APPROVED'
      : normalizedOutcome === 'commented'
        ? 'COMMENTED'
        : 'CHANGES REQUESTED';
    const reviewUrl = String(reviewInfo?.reviewUrl || reviewInfo?.url || '').trim();
    const summary = String(reviewInfo?.reviewSummary || summarizeReviewBody(reviewInfo?.reviewBody || '') || '(No detailed comments)').trim();

    return [
      '',
      '--- PR Review Update ---',
      `PR #${reviewInfo.number || number || '?'} reviewed by ${reviewInfo.reviewUser || 'AI reviewer'}.`,
      `Outcome: ${outcomeLabel}`,
      reviewInfo.reviewAgent ? `Reviewer agent: ${String(reviewInfo.reviewAgent).trim()}` : '',
      reviewUrl ? `GitHub: ${reviewUrl}` : '',
      '',
      'Summary:',
      summary,
      '',
      normalizedOutcome === 'needs_fix'
        ? 'Please address the feedback and push updated commits.'
        : normalizedOutcome === 'approved'
          ? 'The PR review approved the current changes.'
          : 'The reviewer left comments but did not block the PR.',
      '--- End PR Review Update ---',
      ''
    ].filter(Boolean).join('\n');
  }

  _getPrIdentityFromId(prId) {
    const raw = String(prId || '').trim();
    const match = raw.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) return {};
    return {
      owner: String(match[1] || '').trim(),
      repo: String(match[2] || '').trim(),
      number: Number(match[3]) || 0
    };
  }

  _buildFixPrompt(pr, reviewInfo, cfg) {
    const reviewText = String(reviewInfo?.reviewBody || reviewInfo?.notes || '').trim() || '(no review body provided)';
    return [
      `You are a fixer agent for PR ${pr.number} in ${pr.owner}/${pr.repo}.`,
      pr.title ? `PR title: ${pr.title}` : '',
      pr.author ? `PR author: ${pr.author}` : '',
      pr.url ? `PR URL: ${pr.url}` : '',
      '',
      'You should implement only the changes requested in the latest review.',
      '',
      'Reviewer feedback:',
      reviewText,
      '',
      `Use \`gh pr checkout ${pr.number}\` to check out the branch,`,
      `then use \`gh pr diff ${pr.number}\` to review required changes and apply fixes.`,
      'Keep changes scoped to this PR.',
      'Run relevant tests/lint before finishing and summarize what was changed.',
      '',
      'Output format:',
      '1) What you changed',
      '2) Tests run (commands + result)',
      '3) Remaining risks / follow-up actions',
      `Review body from reviewer: ${String(reviewInfo?.reviewUser || '').trim() ? `by ${String(reviewInfo.reviewUser).trim()}` : 'unknown'}.`
    ].filter(Boolean).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Polling lifecycle
  // ---------------------------------------------------------------------------

  start() {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.pollEnabled) {
      this.stop();
      return;
    }
    if (this.pollTimer) return;
    const ms = Math.max(15_000, Number(cfg.pollMs) || 60_000);
    logger.info('Starting PR review automation polling', { intervalMs: ms });
    this.pollTimer = setInterval(() => this.poll().catch(e => logger.error('Poll error', { error: e.message })), ms);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info('Stopped PR review automation polling');
    }
  }

  // ---------------------------------------------------------------------------
  // Poll: detect new PRs and completed reviews
  // ---------------------------------------------------------------------------

  async poll() {
    const cfg = this.getConfig();
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };

    const now = new Date().toISOString();
    const results = { newPrs: 0, reviewsProcessed: 0, agentsSpawned: 0, errors: [] };

    try {
      // Phase 1: Detect new open PRs not yet tracked
      const newPrs = await this._findNewPrs(cfg);
      for (const pr of newPrs) {
        try {
          await this._handleNewPr(pr, cfg);
          results.newPrs++;
        } catch (e) {
          logger.error('Failed to handle new PR', { pr: pr.id, error: e.message });
          results.errors.push({ pr: pr.id, phase: 'new_pr', error: e.message });
        }
      }

      // Phase 2: Detect completed reviews on PRs we're tracking
      const reviewed = await this._findCompletedReviews(cfg);
      for (const item of reviewed) {
        try {
          await this._handleCompletedReview(item, cfg);
          results.reviewsProcessed++;
        } catch (e) {
          logger.error('Failed to handle completed review', { pr: item.prId, error: e.message });
          results.errors.push({ pr: item.prId, phase: 'review', error: e.message });
        }
      }

      // Phase 3: Spawn reviewers for PRs that need one
      if (cfg.autoSpawnReviewer) {
        const spawned = await this._spawnPendingReviewers(cfg);
        results.agentsSpawned = spawned;
      }
    } catch (e) {
      logger.error('Poll cycle failed', { error: e.message, stack: e.stack });
      results.errors.push({ phase: 'poll', error: e.message });
    }

    this.lastPollAt = now;
    logger.info('Poll cycle complete', results);
    return results;
  }

  // ---------------------------------------------------------------------------
  // Webhook handlers (called from index.js)
  // ---------------------------------------------------------------------------

  async onPrCreated({ owner, repo, number, title, author, url, action }) {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.webhookEnabled) {
      return { ignored: true, reason: 'disabled' };
    }

    const fullRepo = `${owner}/${repo}`;
    if (cfg.repos.length > 0 && !cfg.repos.includes(fullRepo)) {
      return { ignored: true, reason: 'repo_not_configured' };
    }

    const prId = `pr:${owner}/${repo}#${number}`;
    logger.info('Webhook: PR created/ready', { prId, title, author, action });

    const existing = this.taskRecordService?.get?.(prId);
    if (!existing) {
      this.taskRecordService?.upsert?.(prId, {
        tier: cfg.reviewerTier,
        title: title || `PR #${number}`,
        notes: `Auto-detected via webhook (${action})`
      });
    }

    if (cfg.autoSpawnReviewer) {
      const spawned = await this._spawnReviewerForPr({ owner, repo, number, title, author, url, prId }, cfg);
      return { ok: true, prId, spawned };
    }

    return { ok: true, prId, spawned: false };
  }

  async onReviewSubmitted({ owner, repo, number, reviewState, reviewBody, reviewUser, url, reviewUrl }) {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.webhookEnabled) {
      return { ignored: true, reason: 'disabled' };
    }

    const prId = `pr:${owner}/${repo}#${number}`;
    const state = String(reviewState || '').toLowerCase();
    logger.info('Webhook: Review submitted', { prId, state, reviewUser });

    const outcome = state === 'approved' ? 'approved'
      : state === 'changes_requested' ? 'needs_fix'
      : 'commented';

    const snapshot = this._buildReviewSnapshot(prId, {
      owner,
      repo,
      number,
      url,
      reviewBody,
      reviewUser,
      reviewSubmittedAt: new Date().toISOString(),
      reviewUrl: reviewUrl || url
    }, outcome, cfg);

    this.taskRecordService?.upsert?.(prId, {
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      reviewOutcome: outcome,
      reviewEndedAt: new Date().toISOString(),
      ...snapshot
    });

    // Clean up active reviewer tracking
    this.activeReviewers.delete(prId);

    const reviewInfo = {
      owner,
      repo,
      number,
      url,
      reviewBody,
      reviewUser,
      outcome,
      reviewUrl: reviewUrl || url,
      reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
      reviewSummary: snapshot.latestReviewSummary,
      reviewAgent: snapshot.latestReviewAgent
    };

    const followUp = await this._handleReviewFollowUp(prId, reviewInfo, cfg, outcome);
    this._emitUpdate('review-completed', {
      prId,
      outcome,
      reviewUser,
      recordPatch: {
        reviewed: true,
        reviewedAt: new Date().toISOString(),
        reviewOutcome: outcome,
        reviewEndedAt: new Date().toISOString(),
        ...snapshot,
        ...(followUp?.recordPatch || {})
      },
      reviewSummary: snapshot.latestReviewSummary,
      reviewUrl: snapshot.latestReviewUrl,
      pastedToSessionId: followUp?.sessionId || null,
      deliveryAction: followUp?.deliveryAction || null
    });
    return { ok: true, prId, outcome };
  }

  // ---------------------------------------------------------------------------
  // Status + manual trigger
  // ---------------------------------------------------------------------------

  getStatus() {
    const cfg = this.getConfig();
    return {
      enabled: cfg.enabled,
      polling: !!this.pollTimer,
      lastPollAt: this.lastPollAt,
      activeReviewers: Array.from(this.activeReviewers.entries()).map(([prId, info]) => ({
        prId,
        worktreeId: info.worktreeId,
        sessionId: info.sessionId,
        spawnedAt: info.spawnedAt
      })),
      config: cfg
    };
  }

  async runManual() {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return { error: 'PR review automation is disabled. Enable it first.' };
    }
    return this.poll();
  }

  // ---------------------------------------------------------------------------
  // Internal: find new PRs
  // ---------------------------------------------------------------------------

  async _findNewPrs(cfg) {
    if (!this.pullRequestService) return [];
    const repos = cfg.repos || [];
    const allPrs = [];

    for (const fullRepo of repos) {
      try {
        const [owner, repo] = fullRepo.split('/');
        if (!owner || !repo) continue;
        const prs = await this.pullRequestService.searchPullRequests({
          mode: 'all',
          state: 'open',
          repo: fullRepo,
          limit: 20
        });
        for (const pr of (Array.isArray(prs) ? prs : [])) {
          const prId = pr.id || `pr:${owner}/${repo}#${pr.number}`;
          const existing = this.taskRecordService?.get?.(prId);
          if (!existing && !this.processedPrKeys.has(prId)) {
            allPrs.push({ ...pr, owner, repo, prId });
          }
        }
      } catch (e) {
        logger.error('Failed to search PRs for repo', { repo: fullRepo, error: e.message });
      }
    }

    return allPrs;
  }

  // ---------------------------------------------------------------------------
  // Internal: find completed reviews
  // ---------------------------------------------------------------------------

  async _findCompletedReviews(cfg) {
    const records = this.taskRecordService?.list?.() || [];
    const reviewed = [];

    for (const record of records) {
      const id = record.id || '';
      if (!id.startsWith('pr:')) continue;
      if (record.reviewedAt) continue;
      if (!record.reviewerSpawnedAt) continue;

      // Check if the reviewer has submitted a review via GitHub API
      const match = id.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
      if (!match) continue;
      const [, owner, repo, numStr] = match;
      const number = parseInt(numStr, 10);

      try {
        const prData = await this.pullRequestService.getPullRequest({
          owner, repo, number,
          fields: ['reviews', 'html_url', 'url', 'title']
        });
        const reviews = prData?.reviews || [];
        const latestReview = reviews
          .filter(r => r.state && r.state !== 'PENDING' && r.state !== 'DISMISSED')
          .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0];

        if (latestReview) {
          const submittedAt = latestReview.submittedAt || '';
          const spawnedAt = record.reviewerSpawnedAt || '';
          if (submittedAt && (!spawnedAt || new Date(submittedAt) >= new Date(spawnedAt))) {
            reviewed.push({
              prId: id,
              owner,
              repo,
              number,
              title: prData?.title || '',
              url: prData?.html_url || prData?.url || '',
              reviewUrl: latestReview.html_url || prData?.html_url || prData?.url || '',
              reviewSubmittedAt: submittedAt,
              reviewState: latestReview.state,
              reviewBody: latestReview.body || '',
              reviewUser: latestReview.author?.login || ''
            });
          }
        }
      } catch (e) {
        logger.warn('Failed to check reviews for PR', { prId: id, error: e.message });
      }
    }

    return reviewed;
  }

  // ---------------------------------------------------------------------------
  // Internal: handle a newly detected PR
  // ---------------------------------------------------------------------------

  async _handleNewPr(pr, cfg) {
    const prId = pr.prId || `pr:${pr.owner}/${pr.repo}#${pr.number}`;
    this.processedPrKeys.add(prId);

    this.taskRecordService?.upsert?.(prId, {
      tier: cfg.reviewerTier,
      title: pr.title || `PR #${pr.number}`,
      notes: 'Auto-detected via polling'
    });

    logger.info('New PR tracked', { prId, title: pr.title });
    this._emitUpdate('new-pr-tracked', { prId, title: pr.title });
  }

  // ---------------------------------------------------------------------------
  // Internal: handle a completed review
  // ---------------------------------------------------------------------------

  async _handleCompletedReview(item, cfg) {
    const outcome = String(item.reviewState || '').toLowerCase();
    const mappedOutcome = outcome === 'approved' ? 'approved'
      : outcome === 'changes_requested' ? 'needs_fix'
      : 'commented';

    const snapshot = this._buildReviewSnapshot(item.prId, {
      ...item,
      reviewSubmittedAt: item.reviewSubmittedAt || new Date().toISOString(),
      reviewUrl: item.reviewUrl || item.url || ''
    }, mappedOutcome, cfg);

    this.taskRecordService?.upsert?.(item.prId, {
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      reviewOutcome: mappedOutcome,
      reviewEndedAt: new Date().toISOString(),
      ...snapshot
    });

    this.activeReviewers.delete(item.prId);
    logger.info('Review completed', { prId: item.prId, outcome: mappedOutcome });

    const followUp = await this._handleReviewFollowUp(item.prId, {
      ...item,
      reviewSubmittedAt: snapshot.latestReviewSubmittedAt,
      reviewUrl: snapshot.latestReviewUrl,
      reviewSummary: snapshot.latestReviewSummary,
      reviewAgent: snapshot.latestReviewAgent
    }, cfg, mappedOutcome);

    this._emitUpdate('review-completed', {
      prId: item.prId,
      outcome: mappedOutcome,
      reviewUser: item.reviewUser,
      recordPatch: {
        reviewed: true,
        reviewedAt: new Date().toISOString(),
        reviewOutcome: mappedOutcome,
        reviewEndedAt: new Date().toISOString(),
        ...snapshot,
        ...(followUp?.recordPatch || {})
      },
      reviewSummary: snapshot.latestReviewSummary,
      reviewUrl: snapshot.latestReviewUrl,
      pastedToSessionId: followUp?.sessionId || null,
      deliveryAction: followUp?.deliveryAction || null
    });
  }

  async _handleReviewFollowUp(prId, reviewInfo, cfg, outcome) {
    if (outcome === 'needs_fix') {
      return this._routeNeedsFixReview(prId, reviewInfo, cfg);
    }

    const deliveryAction = this._resolveOutcomeDeliveryAction(outcome, cfg);
    if (deliveryAction === 'none') {
      return { deliveryAction };
    }

    return this._sendFeedbackToAuthor(prId, {
      ...reviewInfo,
      reviewSummary: reviewInfo?.reviewSummary || summarizeReviewBody(reviewInfo?.reviewBody || ''),
      reviewAgent: reviewInfo?.reviewAgent || this._inferReviewerAgent(prId, reviewInfo, cfg)
    }, cfg, {
      outcome,
      deliveryAction,
      allowNotesFallback: false
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: spawn reviewers for PRs that need one
  // ---------------------------------------------------------------------------

  async _spawnPendingReviewers(cfg) {
    const records = this.taskRecordService?.list?.() || [];
    let spawned = 0;

    if (this.activeReviewers.size >= (cfg.maxConcurrentReviewers || 3)) {
      logger.info('Max concurrent reviewers reached', { active: this.activeReviewers.size, max: cfg.maxConcurrentReviewers });
      return 0;
    }

    for (const record of records) {
      if (this.activeReviewers.size >= (cfg.maxConcurrentReviewers || 3)) break;

      const id = record.id || '';
      if (!id.startsWith('pr:')) continue;
      if (record.reviewedAt) continue;
      if (record.reviewerSpawnedAt) continue;
      if (this.activeReviewers.has(id)) continue;

      const match = id.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
      if (!match) continue;
      const [, owner, repo, numStr] = match;
      const number = parseInt(numStr, 10);

      try {
        const ok = await this._spawnReviewerForPr({
          owner, repo, number,
          title: record.title || `PR #${number}`,
          prId: id
        }, cfg);
        if (ok) spawned++;
      } catch (e) {
        logger.error('Failed to spawn reviewer', { prId: id, error: e.message });
      }
    }

    return spawned;
  }

  // ---------------------------------------------------------------------------
  // Internal: spawn a single reviewer agent
  // ---------------------------------------------------------------------------

  async _spawnReviewerForPr(pr, cfg) {
    if (!this.sessionManager || !this.workspaceManager) {
      logger.warn('Cannot spawn reviewer - sessionManager or workspaceManager not available');
      return false;
    }

    if (this.activeReviewers.has(pr.prId)) {
      logger.info('Reviewer already active for PR', { prId: pr.prId });
      return false;
    }

    // Find an available worktree in the active workspace
    const reviewerConfig = await this._resolveRunnableReviewerConfig(cfg);
    if (!reviewerConfig) {
      logger.warn('Cannot spawn reviewer - no supported agent CLI available', { prId: pr.prId });
      return false;
    }

    const assignment = await this._findAvailableWorktree(pr, reviewerConfig);

    const worktreeId = assignment?.worktreeId;
    if (!worktreeId) {
      logger.warn('No available worktree for reviewer', { prId: pr.prId });
      return false;
    }

    const sessionId = assignment?.sessionId || `${pr.repo || 'review'}-${worktreeId}-${reviewerConfig.agentId}`;
    const prompt = this._buildReviewPrompt(pr, cfg);

    try {
      const started = this.sessionManager.startAgentWithConfig(sessionId, {
        agentId: reviewerConfig.agentId,
        provider: reviewerConfig.provider,
        mode: reviewerConfig.mode,
        flags: reviewerConfig.flags,
        model: reviewerConfig.model,
        reasoning: reviewerConfig.reasoning,
        verbosity: reviewerConfig.verbosity
      });

      if (!started) {
        logger.warn('Failed to start reviewer agent', { sessionId, prId: pr.prId });
        return false;
      }

      // Wait for agent init, then send prompt
      const initDelay = reviewerConfig.agentId === 'codex' ? 15_000 : 8_000;
      setTimeout(() => {
        this.sessionManager.writeToSession(sessionId, prompt + '\n');
      }, initDelay);

      // Track the active reviewer
      this.activeReviewers.set(pr.prId, {
        worktreeId,
        sessionId,
        spawnedAt: new Date().toISOString()
      });

      // Update task record
      this.taskRecordService?.upsert?.(pr.prId, {
        reviewerSpawnedAt: new Date().toISOString(),
        reviewerWorktreeId: worktreeId,
        reviewerSessionId: sessionId,
        reviewerAgent: reviewerConfig.agentId,
        reviewStartedAt: new Date().toISOString()
      });

      logger.info('Reviewer agent spawned', {
        prId: pr.prId,
        sessionId,
        worktreeId,
        agent: reviewerConfig.agentId,
        mode: reviewerConfig.mode,
        provider: reviewerConfig.provider
      });
      this._emitUpdate('reviewer-spawned', {
        prId: pr.prId,
        sessionId,
        worktreeId,
        agentId: reviewerConfig.agentId,
        recordPatch: {
          reviewerSpawnedAt: new Date().toISOString(),
          reviewerWorktreeId: worktreeId,
          reviewerSessionId: sessionId,
          reviewerAgent: reviewerConfig.agentId,
          reviewStartedAt: new Date().toISOString()
        }
      });
      return true;
    } catch (e) {
      logger.error('Error spawning reviewer', { prId: pr.prId, error: e.message, stack: e.stack });
      return false;
    }
  }

  async _spawnFixerForPr(pr, cfg, reviewInfo = {}) {
    if (!this.sessionManager || !this.workspaceManager) {
      logger.warn('Cannot spawn fixer - sessionManager or workspaceManager not available');
      return false;
    }

    if (this.activeFixers.has(pr.prId)) {
      logger.info('Fixer already active for PR', { prId: pr.prId });
      return false;
    }

    const fixerConfig = await this._resolveRunnableReviewerConfig(cfg);
    if (!fixerConfig) {
      logger.warn('Cannot spawn fixer - no supported agent CLI available', { prId: pr.prId });
      return false;
    }

    const assignment = await this._findAvailableWorktree(pr, fixerConfig);

    const worktreeId = assignment?.worktreeId;
    if (!worktreeId) {
      logger.warn('No available worktree for fixer', { prId: pr.prId });
      return false;
    }

    const sessionId = assignment?.sessionId || `${pr.repo || 'fix'}-${worktreeId}-${fixerConfig.agentId}`;
    const prompt = this._buildFixPrompt(pr, reviewInfo, cfg);

    try {
      const started = this.sessionManager.startAgentWithConfig(sessionId, {
        agentId: fixerConfig.agentId,
        provider: fixerConfig.provider,
        mode: fixerConfig.mode,
        flags: fixerConfig.flags,
        model: fixerConfig.model,
        reasoning: fixerConfig.reasoning,
        verbosity: fixerConfig.verbosity
      });

      if (!started) {
        logger.warn('Failed to start fixer agent', { sessionId, prId: pr.prId });
        return false;
      }

      const initDelay = fixerConfig.agentId === 'codex' ? 15_000 : 8_000;
      setTimeout(() => {
        this.sessionManager.writeToSession(sessionId, prompt + '\n');
      }, initDelay);

      this.activeFixers.set(pr.prId, {
        worktreeId,
        sessionId,
        spawnedAt: new Date().toISOString()
      });

      this.taskRecordService?.upsert?.(pr.prId, {
        fixerSpawnedAt: new Date().toISOString(),
        fixerWorktreeId: worktreeId
      });

      logger.info('Fixer agent spawned', {
        prId: pr.prId,
        sessionId,
        worktreeId,
        agent: fixerConfig.agentId,
        mode: fixerConfig.mode
      });
      this._emitUpdate('fixer-spawned', { prId: pr.prId, sessionId, worktreeId });
      return { worktreeId, sessionId };
    } catch (e) {
      logger.error('Error spawning fixer', { prId: pr.prId, error: e.message, stack: e.stack });
      return false;
    }
  }

  async _routeNeedsFixReview(prId, reviewInfo, cfg) {
    const action = this._resolvePostReviewAction(prId, cfg);
    const parsed = this._getPrIdentityFromId(prId);
    const deliveryAction = this._resolveOutcomeDeliveryAction('needs_fix', cfg);

    if (action === 'auto_fix') {
      const record = this.taskRecordService?.get?.(prId) || {};
      const resolvedOwner = String(reviewInfo?.owner || '').trim()
        || String(record.owner || '').trim()
        || parsed.owner;
      const resolvedRepo = String(reviewInfo?.repo || '').trim()
        || String(record.repo || '').trim()
        || parsed.repo;
      const resolvedNumber = Number(reviewInfo?.number || parsed.number || 0);

      const resolved = {
        ...reviewInfo,
        title: String(reviewInfo?.title || record.title || '').trim(),
        owner: resolvedOwner,
        repo: resolvedRepo,
        number: resolvedNumber,
        url: String(reviewInfo?.url || record.url || '').trim(),
        reviewBody: reviewInfo?.reviewBody || record.notes || ''
      };
      const spawnOk = await this._spawnFixerForPr(
        {
          prId,
          number: Number(resolved.number),
          title: String(resolved.title || '').trim(),
          owner: String(resolved.owner || '').trim(),
          repo: String(resolved.repo || '').trim(),
          author: String(resolved.reviewUser || '').trim(),
          url: String(resolved.url || '').trim()
        },
        cfg,
        { ...reviewInfo, reviewBody: resolved.reviewBody }
      );

      if (!spawnOk) {
        return this._sendFeedbackToAuthor(prId, {
          ...resolved,
          reviewSummary: summarizeReviewBody(resolved.reviewBody || ''),
          reviewAgent: reviewInfo?.reviewAgent || this._inferReviewerAgent(prId, reviewInfo, cfg)
        }, cfg, {
          outcome: 'needs_fix',
          deliveryAction,
          allowNotesFallback: true
        });
      }

      return {
        deliveryAction: 'auto_fix',
        recordPatch: {
          fixerSpawnedAt: new Date().toISOString(),
          fixerWorktreeId: spawnOk?.worktreeId || null
        },
        sessionId: spawnOk?.sessionId || null
      };
    }

    return this._sendFeedbackToAuthor(prId, {
      ...reviewInfo,
      owner: reviewInfo?.owner || '',
      repo: reviewInfo?.repo || '',
      reviewSummary: reviewInfo?.reviewSummary || summarizeReviewBody(reviewInfo?.reviewBody || ''),
      reviewAgent: reviewInfo?.reviewAgent || this._inferReviewerAgent(prId, reviewInfo, cfg)
    }, cfg, {
      outcome: 'needs_fix',
      deliveryAction,
      allowNotesFallback: true
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: find an available worktree for reviewer
  // ---------------------------------------------------------------------------

  async _findAvailableWorktree(pr, cfg) {
    if (!this.workspaceManager) return null;

    // Get active workspace
    const activeWs = this.workspaceManager.getActiveWorkspace?.();
    const wsId = activeWs?.id;
    if (!wsId) {
      logger.warn('No active workspace found for reviewer spawn');
      return null;
    }

    const workspace = this.workspaceManager.getWorkspaceById?.(wsId);
    if (!workspace) return null;
    const reviewerConfig = cfg?.agentId ? cfg : this._resolveReviewerConfig(cfg);
    const fallbackRepo = String(pr?.repo || '').trim() || 'review';

    const preferredSessionIdsForWorktree = (repoPrefix, worktreeId) => {
      const ids = [
        `${repoPrefix}-${worktreeId}-${reviewerConfig.agentId}`,
        `${repoPrefix}-${worktreeId}-claude`,
        `${repoPrefix}-${worktreeId}-codex`
      ];
      return [...new Set(ids)];
    };

    // Find worktrees that aren't currently used by active reviewers
    const usedWorktrees = new Set(
      Array.from(this.activeReviewers.values()).map(r => r.worktreeId)
    );

    const terminals = workspace.terminals || [];
    for (const terminal of terminals) {
      const wId = terminal.worktreeId || terminal.worktree;
      if (!wId) continue;
      if (usedWorktrees.has(wId)) continue;

      // Check if the session in this worktree is idle/exited
      const repoName = terminal.repository?.name || terminal.repositoryName || '';
      const repoPrefix = String(repoName || fallbackRepo).trim();
      for (const candidateSessionId of preferredSessionIdsForWorktree(repoPrefix, wId)) {
        const session = this.sessionManager?.getSessionById?.(candidateSessionId);
        if (session && (session.status === 'exited' || session.status === 'idle')) {
          return {
            worktreeId: wId,
            sessionId: candidateSessionId
          };
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Internal: build the review prompt
  // ---------------------------------------------------------------------------

  _buildReviewPrompt(pr, cfg) {
    const parts = [
      `You are reviewing PR #${pr.number} in ${pr.owner}/${pr.repo}.`,
      pr.title ? `PR title: ${pr.title}` : '',
      pr.author ? `PR author: ${pr.author}` : '',
      pr.url ? `PR URL: ${pr.url}` : '',
      '',
      'Review the changes carefully. Focus on:',
      '1. Correctness - does the code work as intended?',
      '2. Security - any vulnerabilities introduced?',
      '3. Tests - are changes adequately tested?',
      '4. Style - follows project patterns and conventions?',
      '',
      `Use \`gh pr diff ${pr.number}\` to see the changes.`,
      `Use \`gh pr view ${pr.number}\` for PR details.`,
      `Use \`gh pr view ${pr.number} --comments\` for existing comments.`,
      '',
      'When done, submit your review:',
      `- \`gh pr review ${pr.number} --approve -b "LGTM"\` if the changes look good`,
      `- \`gh pr review ${pr.number} --request-changes -b "your feedback here"\` if issues found`,
      `- \`gh pr review ${pr.number} --comment -b "your notes"\` for non-blocking feedback`,
      '',
      'Be thorough but concise. Focus on meaningful issues, not style nitpicks.'
    ];
    return parts.filter(Boolean).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal: send feedback to original author session
  // ---------------------------------------------------------------------------

  async _sendFeedbackToAuthor(prId, reviewInfo, cfg, options = {}) {
    const record = this.taskRecordService?.get?.(prId);
    if (!record) return;

    const outcome = String(options?.outcome || reviewInfo?.outcome || 'needs_fix').trim().toLowerCase();
    const deliveryAction = normalizeDeliveryAction(options?.deliveryAction, outcome === 'needs_fix' ? 'paste_and_notify' : 'notify');
    const allowNotesFallback = options?.allowNotesFallback !== false;

    const match = prId.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) return;
    const [, , repo] = match;

    const preferredAgentId = normalizeAgentId(reviewInfo?.reviewAgent || record?.reviewerAgent || cfg?.reviewerAgent || 'claude');
    const preferredSuffix = `-${preferredAgentId}`;
    const repoNeedle = String(repo || '').trim().toLowerCase();
    const targetWorktree = String(record.reviewSourceWorktreeId || '').trim().toLowerCase();
    const configuredSessionId = String(record.reviewSourceSessionId || '').trim();

    const entries = this.sessionManager?.getAllSessionEntries?.() || [];
    let targetSession = null;

    if (configuredSessionId) {
      for (const [sid, session] of entries) {
        if (String(sid || '').trim() !== configuredSessionId) continue;
        if (session?.status === 'exited') continue;
        targetSession = configuredSessionId;
        break;
      }
    }

    const isAgentSession = (sid, session) => {
      const lower = String(sid || '').toLowerCase();
      if (session?.status === 'exited') return false;
      return lower.endsWith('-claude') || lower.endsWith('-codex');
    };

    if (!targetSession) {
      for (const [sid, session] of entries) {
        const sidLower = String(sid || '').toLowerCase();
        if (!isAgentSession(sid, session)) continue;
        if (targetWorktree && sidLower.includes(`-${targetWorktree}-`) && sidLower.endsWith(preferredSuffix)) {
          targetSession = sid;
          break;
        }
      }
    }

    if (!targetSession) {
      for (const [sid, session] of entries) {
        const sidLower = String(sid || '').toLowerCase();
        if (!isAgentSession(sid, session)) continue;
        if (!repoNeedle || sidLower.includes(repoNeedle)) {
          if (sidLower.endsWith(preferredSuffix)) {
            targetSession = sid;
            break;
          }
        }
      }
    }

    if (!targetSession) {
      for (const [sid, session] of entries) {
        const sidLower = String(sid || '').toLowerCase();
        if (!isAgentSession(sid, session)) continue;
        if (!repoNeedle || sidLower.includes(repoNeedle)) {
          targetSession = sid;
          break;
        }
      }
    }

    const feedbackMsg = this._buildReviewFeedbackMessage(prId, reviewInfo, outcome);
    const notesSummary = String(reviewInfo?.reviewSummary || summarizeReviewBody(reviewInfo?.reviewBody || '') || '(No detailed comments)').trim();

    if (targetSession && (deliveryAction === 'paste' || deliveryAction === 'paste_and_notify')) {
      logger.info('Sending review feedback to session', { prId, sessionId: targetSession });
      this.sessionManager.writeToSession(targetSession, feedbackMsg);
      const deliveredAt = new Date().toISOString();
      this.taskRecordService?.upsert?.(prId, { latestReviewDeliveredAt: deliveredAt });
      return {
        deliveryAction,
        sessionId: targetSession,
        recordPatch: { latestReviewDeliveredAt: deliveredAt }
      };
    }

    if (allowNotesFallback) {
      logger.info('No active session found for review delivery, storing in task record', { prId, deliveryAction });
      this.taskRecordService?.upsert?.(prId, {
        notes: `Review (${outcome}) by ${reviewInfo.reviewUser || 'AI'}: ${notesSummary}`
      });
    }

    return { deliveryAction, sessionId: null };
  }

  // ---------------------------------------------------------------------------
  // Internal: emit Socket.IO update
  // ---------------------------------------------------------------------------

  _emitUpdate(event, data) {
    if (this.io) {
      this.io.emit('pr-review-automation', { event, ...data, at: new Date().toISOString() });
    }
  }
}

module.exports = { PrReviewAutomationService };
