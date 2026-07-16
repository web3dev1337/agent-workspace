'use strict';

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const { findAvailableWorktree, spawnAgentInSession } = require('./agentSpawnHelper');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(process.cwd(), 'logs', 'review-workflows.log'), maxsize: 2_000_000, maxFiles: 2 })
  ]
});

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'review-workflows.json');
const USER_CONFIG_PATH = path.join(getAgentWorkspaceDir(), 'review-workflows.json');
const POLL_MS = 30_000;
const PR_ID_RE = /^pr:([^/]+)\/([^#]+)#(\d+)$/;

const deepMerge = (base, override) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(base[k], v);
  }
  return out;
};

class ReviewWorkflowService {
  constructor(deps = {}) {
    this.taskRecordService = deps.taskRecordService || null;
    this.pullRequestService = deps.pullRequestService || null;
    this.sessionManager = deps.sessionManager || null;
    this.workspaceManager = deps.workspaceManager || null;
    this.evidenceService = deps.evidenceService || null;
    this.io = deps.io || null;
    this.configPath = deps.configPath || DEFAULT_CONFIG_PATH;
    this.userConfigPath = deps.userConfigPath || USER_CONFIG_PATH;

    this.pollTimer = null;
    this._configCache = null;
    this._configCacheAt = 0;
  }

  static getInstance(deps = {}) {
    if (!ReviewWorkflowService.instance) {
      ReviewWorkflowService.instance = new ReviewWorkflowService(deps);
    }
    return ReviewWorkflowService.instance;
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  getConfig({ force = false } = {}) {
    const now = Date.now();
    if (!force && this._configCache && now - this._configCacheAt < 10_000) {
      return this._configCache;
    }

    let base = { roles: {}, workflows: {}, riskDefaults: {}, stageTimeoutMinutes: 45 };
    try {
      base = deepMerge(base, JSON.parse(fs.readFileSync(this.configPath, 'utf8')));
    } catch (e) {
      logger.error('Failed to read review workflow config', { path: this.configPath, error: e.message });
    }

    try {
      if (fs.existsSync(this.userConfigPath)) {
        base = deepMerge(base, JSON.parse(fs.readFileSync(this.userConfigPath, 'utf8')));
      }
    } catch (e) {
      logger.warn('Failed to merge user review workflow config', { path: this.userConfigPath, error: e.message });
    }

    this._configCache = base;
    this._configCacheAt = now;
    return base;
  }

  getWorkflowForRisk(risk) {
    const cfg = this.getConfig();
    const id = cfg.riskDefaults?.[String(risk || '').toLowerCase()] || 'standard';
    return cfg.workflows?.[id] ? id : Object.keys(cfg.workflows || {})[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------

  getRun(taskId) {
    return this.taskRecordService?.get?.(taskId)?.reviewWorkflow || null;
  }

  async startWorkflow(taskId, workflowId, { standards = [] } = {}) {
    if (!PR_ID_RE.test(String(taskId || ''))) {
      throw new Error('Review workflows currently support pr:* tasks only');
    }

    const cfg = this.getConfig();
    const workflow = cfg.workflows?.[workflowId];
    if (!workflow || !Array.isArray(workflow.stages) || !workflow.stages.length) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }

    const existing = this.getRun(taskId);
    if (existing && (existing.status === 'running' || existing.status === 'pending')) {
      throw new Error('A review workflow is already running for this task');
    }

    const run = {
      workflowId,
      status: 'running',
      stageIndex: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: workflow.stages.map((s) => ({
        role: s.role,
        agentId: s.agentId || 'claude',
        model: s.model || null,
        effort: s.effort || null,
        status: 'pending'
      }))
    };

    await this.taskRecordService.upsert(taskId, { reviewWorkflow: run });
    const spawned = await this._spawnStage(taskId, 0, { standards });
    if (!spawned) {
      await this._patchRun(taskId, { status: 'stalled' });
      this._emit('stage-spawn-failed', { taskId, stageIndex: 0 });
      return this.getRun(taskId);
    }

    this.startPolling();
    this._emit('workflow-started', { taskId, workflowId });
    return this.getRun(taskId);
  }

  async cancelWorkflow(taskId) {
    const run = this.getRun(taskId);
    if (!run) return null;
    await this._patchRun(taskId, { status: 'cancelled', completedAt: new Date().toISOString() });
    this._emit('workflow-cancelled', { taskId });
    return this.getRun(taskId);
  }

  // Force-advance past a stalled/failed stage.
  async advanceWorkflow(taskId) {
    const run = this.getRun(taskId);
    if (!run || !Array.isArray(run.stages)) return null;
    const idx = Number(run.stageIndex) || 0;
    const stages = run.stages.map((s, i) => (i === idx && s.status !== 'done')
      ? { ...s, status: 'skipped', completedAt: new Date().toISOString() }
      : s);
    await this._patchRun(taskId, { stages });
    await this._proceedFrom(taskId, idx);
    return this.getRun(taskId);
  }

  // ---------------------------------------------------------------------------
  // Stage mechanics
  // ---------------------------------------------------------------------------

  async _patchRun(taskId, patch) {
    const run = this.getRun(taskId) || {};
    const next = { ...run, ...patch, updatedAt: new Date().toISOString() };
    await this.taskRecordService.upsert(taskId, { reviewWorkflow: next });
    return next;
  }

  async _spawnStage(taskId, stageIndex, { standards = [] } = {}) {
    const run = this.getRun(taskId);
    const stage = run?.stages?.[stageIndex];
    if (!stage) return false;

    const match = String(taskId).match(PR_ID_RE);
    if (!match) return false;
    const [, owner, repo, numStr] = match;
    const number = parseInt(numStr, 10);

    const target = findAvailableWorktree({
      workspaceManager: this.workspaceManager,
      sessionManager: this.sessionManager,
      usedWorktreeIds: new Set(
        (run.stages || [])
          .filter((s, i) => i !== stageIndex && s.status === 'running' && s.worktreeId)
          .map(s => s.worktreeId)
      )
    });
    if (!target) {
      logger.warn('No available worktree for workflow stage', { taskId, stageIndex });
      return false;
    }

    const sessionId = `${target.repoName || repo}-${target.worktreeId}-claude`;
    const record = this.taskRecordService?.get?.(taskId) || {};
    const prompt = this._buildStagePrompt({
      owner,
      repo,
      number,
      title: record.title || `PR #${number}`,
      stage,
      stageIndex,
      stageCount: run.stages.length,
      priorStages: run.stages.slice(0, stageIndex),
      standards
    });

    const started = spawnAgentInSession({
      sessionManager: this.sessionManager,
      sessionId,
      agentId: stage.agentId || 'claude',
      model: stage.model || null,
      effort: stage.effort || null,
      prompt
    });
    if (!started) return false;

    const stages = run.stages.map((s, i) => i === stageIndex
      ? { ...s, status: 'running', sessionId, worktreeId: target.worktreeId, spawnedAt: new Date().toISOString() }
      : s);
    await this._patchRun(taskId, { stages, stageIndex, status: 'running' });
    this._emit('stage-spawned', { taskId, stageIndex, role: stage.role, sessionId });
    return true;
  }

  _buildStagePrompt({ owner, repo, number, title, stage, stageIndex, stageCount, priorStages, standards }) {
    const cfg = this.getConfig();
    const role = cfg.roles?.[stage.role] || {};
    const focusBullets = Array.isArray(role.focusBullets) && role.focusBullets.length
      ? role.focusBullets
      : ['Correctness', 'Security', 'Tests', 'Conventions'];

    const priorSummary = (priorStages || [])
      .filter(s => s.verdict)
      .map(s => `- ${s.role}: ${s.verdict}`)
      .join('\n');

    const standardsList = (standards && standards.length ? standards : ['CLAUDE.md', 'CODEBASE_DOCUMENTATION.md'])
      .map(s => `- ${s}`)
      .join('\n');

    return [
      `You are the ${role.label || stage.role} in stage ${stageIndex + 1}/${stageCount} of an agent review chain for PR #${number} in ${owner}/${repo}.`,
      title ? `PR title: ${title}` : '',
      '',
      'Do NOT create branches or modify any files. This is a READ-ONLY review.',
      '',
      `Your review focus (${stage.role}):`,
      ...focusBullets.map(b => `- ${b}`),
      '',
      'Standards to review against (read them first):',
      standardsList,
      '',
      priorSummary ? `Earlier stages in this chain concluded:\n${priorSummary}\nRead their comments with \`gh pr view ${number} --comments\` and do not repeat confirmed findings — verify the fixes instead.` : '',
      '',
      `Use \`gh pr diff ${number}\` and \`gh pr view ${number}\` to inspect the change. Check out and run tests if the repo supports it.`,
      '',
      'When done you MUST do BOTH of the following:',
      `1. Post your structured result as a PR comment containing a fenced agent-evidence block (see docs/agents/EVIDENCE_PROTOCOL.md in the orchestrator repo). Format:`,
      '```',
      `gh pr comment ${number} --body '<review summary text>`,
      '',
      '```agent-evidence',
      JSON.stringify({
        reviews: [{
          role: stage.role,
          agentId: stage.agentId || 'claude',
          model: stage.model || undefined,
          verdict: 'approved | needs_fix | commented',
          summary: 'one-paragraph outcome',
          findings: 0,
          fixed: 0
        }]
      }, null, 2),
      '```',
      "'",
      '```',
      `2. Submit the matching GitHub review verdict:`,
      `   - \`gh pr review ${number} --approve -b "..."\` if it passes your review`,
      `   - \`gh pr review ${number} --request-changes -b "specific, actionable feedback"\` if it must change`,
      `   - \`gh pr review ${number} --comment -b "..."\` for non-blocking notes`,
      '',
      'Be thorough but concise. Meaningful issues only, no style nitpicks.'
    ].filter(Boolean).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Progress detection (polls GitHub reviews for the running stage)
  // ---------------------------------------------------------------------------

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.pollActiveRuns().catch(e => logger.error('Workflow poll failed', { error: e.message }));
    }, POLL_MS);
    if (typeof this.pollTimer?.unref === 'function') this.pollTimer.unref();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  listActiveRuns() {
    const records = this.taskRecordService?.list?.() || [];
    return records
      .filter(r => r?.reviewWorkflow && (r.reviewWorkflow.status === 'running'))
      .map(r => ({ taskId: r.id, run: r.reviewWorkflow }));
  }

  async pollActiveRuns() {
    // Serialize poll cycles: a slow GitHub round-trip must not let a second
    // interval tick start and act on the same stale run snapshot (which could
    // spawn the next reviewer twice).
    if (this._polling) return { skipped: true, reason: 'in-progress' };
    this._polling = true;
    try {
      const active = this.listActiveRuns();
      if (!active.length) {
        this.stopPolling();
        return { checked: 0 };
      }

      let progressed = 0;
      for (const { taskId } of active) {
        try {
          const moved = await this._checkRun(taskId);
          if (moved) progressed++;
        } catch (e) {
          logger.warn('Failed to check workflow run', { taskId, error: e.message });
        }
      }
      return { checked: active.length, progressed };
    } finally {
      this._polling = false;
    }
  }

  async _checkRun(taskId) {
    // Re-read the run fresh (not a snapshot from listActiveRuns): the state
    // may have changed since the poll cycle began.
    const run = this.getRun(taskId);
    if (!run || run.status !== 'running') return false;
    const idx = Number(run.stageIndex) || 0;
    const stage = run.stages?.[idx];
    if (!stage || stage.status !== 'running') return false;

    const match = String(taskId).match(PR_ID_RE);
    if (!match) return false;
    const [, owner, repo, numStr] = match;
    const number = parseInt(numStr, 10);

    // Stage timeout → stall the run for human attention.
    const cfg = this.getConfig();
    const timeoutMs = Math.max(5, Number(cfg.stageTimeoutMinutes) || 45) * 60_000;
    const spawnedMs = Date.parse(stage.spawnedAt || '') || 0;
    const timedOut = spawnedMs && Date.now() - spawnedMs > timeoutMs;

    let latestReview = null;
    try {
      const prData = await this.pullRequestService.getPullRequest({ owner, repo, number, fields: ['reviews'] });
      const reviews = prData?.reviews || [];
      const candidates = reviews
        .filter(r => r.state && r.state !== 'PENDING' && r.state !== 'DISMISSED')
        .filter(r => {
          const submitted = Date.parse(r.submittedAt || '') || 0;
          return submitted && spawnedMs && submitted >= spawnedMs;
        })
        .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
      // Prefer a review the stage agent actually authored (it embeds an
      // agent-evidence block / names its role), so a stray human or unrelated
      // bot review submitted during the window can't be misattributed to the
      // stage. Fall back to the latest only if no marked review is found.
      const marker = new RegExp(`agent-evidence|"role"\\s*:\\s*"${stage.role}"|\\b${stage.role}\\b`, 'i');
      latestReview = candidates.find(r => marker.test(String(r.body || ''))) || candidates[0] || null;
    } catch (e) {
      logger.warn('Failed to fetch PR reviews for workflow', { taskId, error: e.message });
    }

    // CAS guard: the run/stage state must not have advanced while we were
    // awaiting GitHub. If it did, abandon this check — a later poll re-reads.
    const fresh = this.getRun(taskId);
    if (!fresh || fresh.status !== 'running' || Number(fresh.stageIndex) !== idx
        || fresh.stages?.[idx]?.status !== 'running'
        || fresh.stages?.[idx]?.spawnedAt !== stage.spawnedAt) {
      return false;
    }

    if (!latestReview) {
      if (timedOut) {
        const stages = run.stages.map((s, i) => i === idx ? { ...s, status: 'failed' } : s);
        await this._patchRun(taskId, { stages, status: 'stalled' });
        this._emit('stage-timeout', { taskId, stageIndex: idx, role: stage.role });
        return true;
      }
      return false;
    }

    const state = String(latestReview.state || '').toLowerCase();
    const verdict = state === 'approved' ? 'approved'
      : state === 'changes_requested' ? 'needs_fix'
      : 'commented';

    const stages = run.stages.map((s, i) => i === idx
      ? { ...s, status: 'done', verdict, completedAt: latestReview.submittedAt || new Date().toISOString() }
      : s);
    await this._patchRun(taskId, { stages });

    // Record the stage outcome into the evidence review chain.
    try {
      await this.evidenceService?.setDirect?.(taskId, {
        reviews: [{
          role: stage.role,
          agentId: stage.agentId,
          model: stage.model || undefined,
          effort: stage.effort || undefined,
          verdict,
          summary: String(latestReview.body || '').slice(0, 2000) || undefined,
          at: latestReview.submittedAt || new Date().toISOString(),
          by: latestReview.author?.login || stage.sessionId || undefined
        }]
      });
      // Pull in any agent-evidence comment blocks the reviewer posted.
      await this.evidenceService?.refresh?.(taskId);
    } catch (e) {
      logger.warn('Failed to record stage evidence', { taskId, error: e.message });
    }

    this._emit('stage-completed', { taskId, stageIndex: idx, role: stage.role, verdict });

    if (verdict === 'needs_fix') {
      await this._patchRun(taskId, { status: 'blocked_fix' });
      this._emit('workflow-blocked', { taskId, stageIndex: idx, role: stage.role });
      return true;
    }

    await this._proceedFrom(taskId, idx);
    return true;
  }

  async _proceedFrom(taskId, completedIndex) {
    const run = this.getRun(taskId);
    if (!run) return;
    const nextIndex = completedIndex + 1;
    if (nextIndex >= (run.stages?.length || 0)) {
      await this._patchRun(taskId, { status: 'complete', completedAt: new Date().toISOString() });
      this._emit('workflow-complete', { taskId, workflowId: run.workflowId });
      return;
    }
    const spawned = await this._spawnStage(taskId, nextIndex, {});
    if (!spawned) {
      await this._patchRun(taskId, { status: 'stalled', stageIndex: nextIndex });
      this._emit('stage-spawn-failed', { taskId, stageIndex: nextIndex });
    }
  }

  _emit(event, data) {
    if (this.io) {
      this.io.emit('review-workflow', { event, ...data, at: new Date().toISOString() });
    }
  }
}

module.exports = { ReviewWorkflowService };
