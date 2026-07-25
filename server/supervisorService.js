const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const { QuietTracker, gatherSignals } = require('./supervisor/supervisorSignals');
const rulesModule = require('./supervisor/supervisorRules');
const { createExecutor } = require('./supervisor/supervisorActions');

const AUDIT_FILENAME = 'supervisor-audit.jsonl';

/**
 * The fleet supervisor.
 *
 * Watches every agent session on a fixed tick using signals that cost nothing —
 * PTY tail, status, how long a buffer has been quiet, git state — matches them
 * against a data-driven condition table, and climbs an escalation ladder capped
 * by the configured autonomy level.
 *
 * No model is called in the loop. Judgement is only invoked on escalation, which
 * is what makes continuous supervision affordable to leave running.
 */
class SupervisorService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.sessionManager = null;
    this.gitHelper = null;
    this.agentManager = null;
    this.sessionRecoveryService = null;
    this.taskRecordService = null;
    this.activityFeed = null;
    this.notificationService = null;
    this.speechService = null;

    this.rules = rulesModule.loadRules();
    this.quietTracker = new QuietTracker();
    this.executor = null;
    this.timer = null;
    this.running = false;
    this.ticking = false;

    this.findings = [];
    this.lastTickAt = null;
    this.lastTickDurationMs = null;
    this.tickCount = 0;
    this.cooldowns = new Map();
  }

  static getInstance(options = {}) {
    if (!SupervisorService.instance) {
      SupervisorService.instance = new SupervisorService(options);
    }
    return SupervisorService.instance;
  }

  init({
    sessionManager, gitHelper, agentManager, sessionRecoveryService,
    taskRecordService, activityFeed, notificationService, speechService
  } = {}) {
    this.sessionManager = sessionManager || this.sessionManager;
    this.gitHelper = gitHelper || this.gitHelper;
    this.agentManager = agentManager || this.agentManager;
    this.sessionRecoveryService = sessionRecoveryService || this.sessionRecoveryService;
    this.taskRecordService = taskRecordService || this.taskRecordService;
    this.activityFeed = activityFeed || this.activityFeed;
    this.notificationService = notificationService || this.notificationService;
    this.speechService = speechService || this.speechService;

    this.executor = createExecutor({
      sessionManager: this.sessionManager,
      gitHelper: this.gitHelper,
      agentManager: this.agentManager,
      activityFeed: this.activityFeed,
      notificationService: this.notificationService,
      speechService: this.speechService,
      logger: this.logger
    });

    return this;
  }

  auditPath() {
    const logsDir = path.join(getAgentWorkspaceDir(), 'logs');
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // Losing the audit trail must not stop supervision.
    }
    return path.join(logsDir, AUDIT_FILENAME);
  }

  appendAudit(row) {
    try {
      fs.appendFileSync(this.auditPath(), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, 'utf8');
    } catch (error) {
      this.logger.warn?.('Supervisor could not write its audit log', { error: error.message });
    }
  }

  reloadRules({ rulesPath = null } = {}) {
    this.rules = rulesModule.loadRules({ rulesPath });
    if (this.running) this.restartTimer();
    return this.rules;
  }

  setAutonomy(level) {
    if (!rulesModule.AUTONOMY_LEVELS.includes(level)) {
      throw new Error(`Unknown autonomy level "${level}" (expected ${rulesModule.AUTONOMY_LEVELS.join('|')})`);
    }
    const previous = this.rules.autonomy;
    this.rules.autonomy = level;
    this.appendAudit({ event: 'autonomy-changed', from: previous, to: level });
    return level;
  }

  isCoolingDown(finding, condition) {
    const cooldownMs = Math.max(0, Number(condition?.cooldownSeconds || 0)) * 1000;
    if (!cooldownMs) return false;
    const last = this.cooldowns.get(finding.id);
    return Boolean(last && Date.now() - last < cooldownMs);
  }

  markActed(finding) {
    this.cooldowns.set(finding.id, Date.now());
  }

  recordFinding(entry) {
    this.findings.unshift(entry);
    const cap = this.rules.maxFindingsRetained;
    if (this.findings.length > cap) this.findings.length = cap;
  }

  /**
   * One pass over the fleet. Safe to call by hand — `POST /api/supervisor/tick`
   * runs exactly this, which is how you validate rule changes without waiting.
   */
  async tick({ dryRun = false } = {}) {
    if (this.ticking) return { skipped: 'already ticking' };
    this.ticking = true;
    const startedAt = Date.now();

    try {
      const signals = await gatherSignals({
        sessionManager: this.sessionManager,
        gitHelper: this.gitHelper,
        sessionRecoveryService: this.sessionRecoveryService,
        taskRecordService: this.taskRecordService,
        quietTracker: this.quietTracker
      });

      const findings = rulesModule.evaluate(signals, this.rules);
      const signalsById = new Map(signals.map((signal) => [signal.sessionId, signal]));
      const conditionsById = new Map(this.rules.conditions.map((condition) => [condition.id, condition]));
      const results = [];

      for (const finding of findings) {
        const condition = conditionsById.get(finding.conditionId);
        if (this.isCoolingDown(finding, condition)) {
          results.push({ ...finding, performed: false, outcome: 'cooling-down' });
          continue;
        }

        if (dryRun) {
          results.push({ ...finding, performed: false, outcome: 'dry-run' });
          continue;
        }

        const executed = await this.executor({
          finding,
          signal: signalsById.get(finding.sessionId),
          rules: this.rules
        });

        if (executed.outcome !== 'observed') {
          this.markActed(finding);
          this.appendAudit({
            event: 'finding',
            id: finding.id,
            conditionId: finding.conditionId,
            sessionId: finding.sessionId,
            severity: finding.severity,
            requestedRung: finding.requestedRung,
            rung: finding.rung,
            outcome: executed.outcome,
            detail: executed.detail || finding.advice
          });
        }

        this.recordFinding(executed);
        results.push(executed);
      }

      this.lastTickAt = new Date().toISOString();
      this.lastTickDurationMs = Date.now() - startedAt;
      this.tickCount += 1;

      return {
        at: this.lastTickAt,
        durationMs: this.lastTickDurationMs,
        autonomy: this.rules.autonomy,
        sessionsWatched: signals.length,
        findings: results
      };
    } catch (error) {
      this.logger.error?.('Supervisor tick failed', { error: error.message, stack: error.stack });
      return { error: error.message };
    } finally {
      this.ticking = false;
    }
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.error?.('Supervisor tick threw', { error: error.message }));
    }, this.rules.tickSeconds * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  start() {
    if (this.running) return { running: true, alreadyRunning: true };
    if (this.rules.autonomy === 'off') return { running: false, reason: 'autonomy is off' };
    this.running = true;
    this.restartTimer();
    this.appendAudit({ event: 'started', autonomy: this.rules.autonomy, tickSeconds: this.rules.tickSeconds });
    return { running: true, tickSeconds: this.rules.tickSeconds, autonomy: this.rules.autonomy };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasRunning = this.running;
    this.running = false;
    if (wasRunning) this.appendAudit({ event: 'stopped' });
    return { running: false, wasRunning };
  }

  getFindings({ limit = 100, severity = '', sessionId = '' } = {}) {
    const wantSeverity = String(severity || '').toLowerCase();
    const wantSession = String(sessionId || '').trim();
    return this.findings
      .filter((finding) => (!wantSeverity || finding.severity === wantSeverity))
      .filter((finding) => (!wantSession || finding.sessionId === wantSession))
      .slice(0, Math.max(1, Number(limit) || 100));
  }

  /**
   * A one-line-per-item read of what needs a human right now. This is what the
   * voice briefing speaks and what the Commander asks for.
   */
  getBriefing({ limit = 6 } = {}) {
    const bySession = new Map();
    for (const finding of this.findings) {
      if (!bySession.has(finding.id)) bySession.set(finding.id, finding);
    }

    const rank = { critical: 0, warn: 1, info: 2 };
    const items = [...bySession.values()]
      .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || String(b.detectedAt).localeCompare(String(a.detectedAt)))
      .slice(0, Math.max(1, Number(limit) || 6))
      .map((finding) => ({
        severity: finding.severity,
        sessionId: finding.sessionId,
        where: finding.worktreeId || finding.sessionId,
        label: finding.label,
        advice: finding.advice,
        outcome: finding.outcome,
        detectedAt: finding.detectedAt
      }));

    const counts = { critical: 0, warn: 0, info: 0 };
    for (const finding of bySession.values()) counts[finding.severity] = (counts[finding.severity] || 0) + 1;

    return {
      autonomy: this.rules.autonomy,
      running: this.running,
      lastTickAt: this.lastTickAt,
      counts,
      items,
      spoken: this.renderSpokenBriefing(items, counts)
    };
  }

  renderSpokenBriefing(items, counts) {
    if (!items.length) {
      return this.running
        ? 'Nothing needs you. The fleet is quiet.'
        : 'The supervisor is not running.';
    }

    const headline = counts.critical
      ? `${counts.critical} thing${counts.critical === 1 ? '' : 's'} need${counts.critical === 1 ? 's' : ''} you now.`
      : `${items.length} thing${items.length === 1 ? '' : 's'} to look at.`;

    const details = items
      .slice(0, 3)
      .map((item) => `${item.where}: ${item.label.toLowerCase()}`)
      .join('. ');

    return `${headline} ${details}.`;
  }

  getStatus() {
    return {
      running: this.running,
      autonomy: this.rules.autonomy,
      tickSeconds: this.rules.tickSeconds,
      rulesSource: this.rules.source,
      conditionCount: this.rules.conditions.length,
      lastTickAt: this.lastTickAt,
      lastTickDurationMs: this.lastTickDurationMs,
      tickCount: this.tickCount,
      findingCount: this.findings.length,
      auditPath: this.auditPath(),
      autonomyLevels: rulesModule.AUTONOMY_LEVELS,
      conditions: this.rules.conditions.map((condition) => ({
        id: condition.id,
        label: condition.label,
        severity: condition.severity,
        rung: condition.rung,
        effectiveRung: rulesModule.effectiveRung(condition.rung, this.rules.autonomy),
        cooldownSeconds: condition.cooldownSeconds
      }))
    };
  }
}

module.exports = SupervisorService;
module.exports.SupervisorService = SupervisorService;
module.exports.rules = rulesModule;
