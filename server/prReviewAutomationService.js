'use strict';

const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(process.cwd(), 'logs', 'pr-review-automation.log'), maxsize: 5_000_000, maxFiles: 3 })
  ]
});

const CONFIG_PATH = 'global.ui.tasks.automations.prReview';

const DEFAULT_CONFIG = {
  enabled: false,
  pollEnabled: true,
  pollMs: 60_000,
  webhookEnabled: true,
  reviewerAgent: 'claude',
  reviewerTier: 3,
  autoSpawnReviewer: true,
  autoFeedbackToAuthor: true,
  autoSpawnFixer: false,
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

    this.lastPollAt = null;
    this.activeReviewers = new Map();
    this.processedPrKeys = new Set();
    this.pollTimer = null;
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

  async onReviewSubmitted({ owner, repo, number, reviewState, reviewBody, reviewUser, url }) {
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

    this.taskRecordService?.upsert?.(prId, {
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      reviewOutcome: outcome,
      reviewEndedAt: new Date().toISOString()
    });

    // Clean up active reviewer tracking
    this.activeReviewers.delete(prId);

    if (outcome === 'needs_fix' && cfg.autoFeedbackToAuthor) {
      await this._sendFeedbackToAuthor(prId, { owner, repo, number, reviewBody, reviewUser, outcome }, cfg);
    }

    this._emitUpdate('review-completed', { prId, outcome, reviewUser });
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
          fields: ['reviews']
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

    this.taskRecordService?.upsert?.(item.prId, {
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      reviewOutcome: mappedOutcome,
      reviewEndedAt: new Date().toISOString()
    });

    this.activeReviewers.delete(item.prId);
    logger.info('Review completed', { prId: item.prId, outcome: mappedOutcome });

    if (mappedOutcome === 'needs_fix' && cfg.autoFeedbackToAuthor) {
      await this._sendFeedbackToAuthor(item.prId, item, cfg);
    }

    this._emitUpdate('review-completed', { prId: item.prId, outcome: mappedOutcome });
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
    const worktreeId = await this._findAvailableWorktree(pr, cfg);
    if (!worktreeId) {
      logger.warn('No available worktree for reviewer', { prId: pr.prId });
      return false;
    }

    const sessionId = `${pr.repo || 'review'}-${worktreeId}-claude`;
    const prompt = this._buildReviewPrompt(pr, cfg);

    try {
      // Start the agent
      const agent = cfg.reviewerAgent || 'claude';
      const started = this.sessionManager.startAgentWithConfig(sessionId, {
        provider: agent,
        skipPermissions: true,
        mode: 'fresh'
      });

      if (!started) {
        logger.warn('Failed to start reviewer agent', { sessionId, prId: pr.prId });
        return false;
      }

      // Wait for agent init, then send prompt
      const initDelay = agent === 'codex' ? 15_000 : 8_000;
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
        reviewStartedAt: new Date().toISOString()
      });

      logger.info('Reviewer agent spawned', { prId: pr.prId, sessionId, worktreeId, agent });
      this._emitUpdate('reviewer-spawned', { prId: pr.prId, sessionId, worktreeId });
      return true;
    } catch (e) {
      logger.error('Error spawning reviewer', { prId: pr.prId, error: e.message, stack: e.stack });
      return false;
    }
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
      const claudeSessionId = `${repoName}-${wId}-claude`;
      const session = this.sessionManager?.getSessionById?.(claudeSessionId);
      if (!session || session.status === 'exited' || session.status === 'idle') {
        return wId;
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

  async _sendFeedbackToAuthor(prId, reviewInfo, cfg) {
    const record = this.taskRecordService?.get?.(prId);
    if (!record) return;

    // Try to find the original author's session from the task record
    // Session IDs follow pattern: repoName-worktreeId-claude
    const match = prId.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) return;
    const [, , repo] = match;

    // Look through all sessions for one working on this repo
    const sessions = this.sessionManager?.getAllSessions?.() || [];
    let targetSession = null;

    for (const [sid, session] of sessions) {
      if (sid.includes(repo) && sid.endsWith('-claude') && session.status !== 'exited') {
        // Check if this session's worktree matches the PR branch
        targetSession = sid;
        break;
      }
    }

    const feedbackMsg = [
      `\n--- PR Review Feedback ---`,
      `PR #${reviewInfo.number} has been reviewed by ${reviewInfo.reviewUser || 'AI reviewer'}.`,
      `Outcome: CHANGES REQUESTED`,
      '',
      reviewInfo.reviewBody || '(No detailed comments)',
      '',
      'Please address the feedback and push updated commits.',
      `--- End Review Feedback ---\n`
    ].join('\n');

    if (targetSession) {
      logger.info('Sending review feedback to session', { prId, sessionId: targetSession });
      this.sessionManager.writeToSession(targetSession, feedbackMsg);
      return;
    }

    // If no active session found and autoSpawnFixer is on, spawn a fixer
    if (cfg.autoSpawnFixer) {
      logger.info('Original session not found, would spawn fixer', { prId });
      this.taskRecordService?.upsert?.(prId, {
        notes: `Review feedback pending - original session not found. Fixer needed.`
      });
    } else {
      logger.info('No active session found for feedback, storing in task record', { prId });
      this.taskRecordService?.upsert?.(prId, {
        notes: `Review: changes requested by ${reviewInfo.reviewUser || 'AI'}. Feedback: ${(reviewInfo.reviewBody || '').slice(0, 500)}`
      });
    }
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
