const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const { QuietTracker, gatherSignals } = require('./supervisor/supervisorSignals');
const rulesModule = require('./supervisor/supervisorRules');
const { createExecutor, submitText } = require('./supervisor/supervisorActions');
const { scoreUrgency, InterruptionBudget, DigestQueue } = require('./supervisor/supervisorUrgency');

const AUDIT_FILENAME = 'supervisor-audit.jsonl';
const MAX_RESUME_DELAY_MS = 12 * 60 * 60 * 1000;

/**
 * JARVIS — the fleet supervisor.
 *
 * Watches every agent session on a fixed tick using signals that cost nothing —
 * PTY tail, status, how long a buffer has been quiet, git state — and then tries
 * to make the problem go away.
 *
 * The ordering is the whole design:
 *
 *   fix it myself  →  hand it to the Commander  →  (only then) interrupt a human
 *
 * A finding that has not exhausted its repair attempts is not even eligible to
 * reach you, and one that has must still clear an urgency threshold weighted by
 * the task's tier and fit inside an interruption budget. Everything else lands
 * in a digest you read when it suits you. Your attention is the scarcest thing
 * in the system and the supervisor is built to spend it last.
 *
 * No model runs in the loop. Judgement is only invoked on delegation.
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
    this.commanderSender = null;
    this.structuredSource = null;

    this.rules = rulesModule.loadRules();
    this.quietTracker = new QuietTracker();
    this.budget = new InterruptionBudget({ policy: this.rules.interruption });
    this.digest = new DigestQueue();
    this.digest.setInterval(this.rules.interruption.digestIntervalMinutes);

    this.executor = null;
    this.timer = null;
    this.running = false;
    this.ticking = false;

    this.findings = [];
    this.attempts = new Map();
    this.cooldowns = new Map();
    this.interruptedAt = new Map();
    this.resumeTimers = new Map();
    this.lastTickAt = null;
    this.lastTickDurationMs = null;
    this.tickCount = 0;
    this.stats = { resolved: 0, delegated: 0, interrupted: 0, digested: 0 };
  }

  static getInstance(options = {}) {
    if (!SupervisorService.instance) {
      SupervisorService.instance = new SupervisorService(options);
    }
    return SupervisorService.instance;
  }

  init({
    sessionManager, gitHelper, agentManager, sessionRecoveryService,
    taskRecordService, activityFeed, notificationService, speechService, commanderSender, structuredSource
  } = {}) {
    this.sessionManager = sessionManager || this.sessionManager;
    this.gitHelper = gitHelper || this.gitHelper;
    this.agentManager = agentManager || this.agentManager;
    this.sessionRecoveryService = sessionRecoveryService || this.sessionRecoveryService;
    this.taskRecordService = taskRecordService || this.taskRecordService;
    this.activityFeed = activityFeed || this.activityFeed;
    this.notificationService = notificationService || this.notificationService;
    this.speechService = speechService || this.speechService;
    this.commanderSender = commanderSender || this.commanderSender;
    this.structuredSource = structuredSource || this.structuredSource;

    this.executor = createExecutor({
      sessionManager: this.sessionManager,
      gitHelper: this.gitHelper,
      agentManager: this.agentManager,
      commanderSender: this.commanderSender,
      scheduleResume: (options) => this.scheduleResume(options),
      activityFeed: this.activityFeed,
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
    this.budget.setPolicy(this.rules.interruption);
    this.digest.setInterval(this.rules.interruption.digestIntervalMinutes);
    if (this.running) this.restartTimer();
    // A reload can swap autonomy and the entire safety table — that must be
    // as traceable as setAutonomy() is.
    this.appendAudit({ event: 'rules-reloaded', source: this.rules.source, autonomy: this.rules.autonomy });
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

  setInterruptionPolicy(patch = {}) {
    this.rules.interruption = { ...this.rules.interruption, ...patch };
    this.budget.setPolicy(this.rules.interruption);
    this.digest.setInterval(this.rules.interruption.digestIntervalMinutes);
    this.appendAudit({ event: 'interruption-policy-changed', policy: this.rules.interruption });
    return this.rules.interruption;
  }

  /**
   * A usage limit is a wait, not a problem. Parse the reset time out of the
   * banner and type `continue` when it passes.
   */
  scheduleResume({ sessionId, at }) {
    const delay = Math.min(MAX_RESUME_DELAY_MS, Math.max(0, at.getTime() - Date.now()));
    const existing = this.resumeTimers.get(sessionId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
      this.resumeTimers.delete(sessionId);
      await submitText(this.sessionManager, sessionId, 'continue');
      this.appendAudit({ event: 'resumed', sessionId, scheduledFor: at.toISOString() });
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();

    this.resumeTimers.set(sessionId, { timer, at: at.toISOString() });
    return at.toISOString();
  }

  /**
   * A high enough urgency score bypasses quiet hours and the hourly budget —
   * but nothing bypasses this. Being told twice in five minutes about the same
   * problem is the failure mode that teaches people to ignore alerts.
   */
  repeatsTooSoon(findingId) {
    const last = this.interruptedAt.get(findingId);
    if (!last) return false;
    return (Date.now() - last) / 1000 < this.rules.interruption.minSecondsBetween;
  }

  isCoolingDown(findingId, condition) {
    const cooldownMs = Math.max(0, Number(condition?.cooldownSeconds || 0)) * 1000;
    if (!cooldownMs) return false;
    const last = this.cooldowns.get(findingId);
    return Boolean(last && Date.now() - last < cooldownMs);
  }

  recordFinding(entry) {
    this.findings.unshift(entry);
    const cap = this.rules.maxFindingsRetained;
    if (this.findings.length > cap) this.findings.length = cap;
  }

  /**
   * Something the supervisor could not handle, that is urgent enough to be
   * worth your attention right now.
   */
  interrupt(finding, score) {
    try {
      this.notificationService?.notify?.(
        finding.sessionId,
        finding.severity === 'critical' ? 'error' : 'warning',
        `${finding.label} — ${finding.worktreeId || finding.sessionId}`,
        { conditionId: finding.conditionId, advice: finding.advice, urgency: score }
      );
    } catch (error) {
      this.logger.warn?.('Supervisor could not send a notification', { error: error.message });
    }

    try {
      this.speechService?.speak?.(
        `${finding.worktreeId || finding.sessionId}: ${finding.label}. ${finding.advice}`,
        { priority: 'high' }
      );
    } catch (error) {
      this.logger.warn?.('Supervisor could not speak', { error: error.message });
    }

    this.activityFeed?.track?.('supervisor.interrupt', {
      sessionId: finding.sessionId,
      conditionId: finding.conditionId,
      severity: finding.severity,
      urgency: score
    });

    this.budget.record();
    this.interruptedAt.set(finding.id, Date.now());
    this.stats.interrupted += 1;
  }

  /**
   * A problem that stopped matching has gone away — clear its repair counter and
   * pull it out of the digest. Reporting solved problems is exactly the noise
   * this is built to avoid.
   */
  forgetHealed(activeFindingIds) {
    for (const id of [...this.attempts.keys()]) {
      if (activeFindingIds.has(id)) continue;
      this.attempts.delete(id);
      this.interruptedAt.delete(id);
      if (this.digest.resolve(id)) {
        this.appendAudit({ event: 'self-healed', id });
      }
    }
    // Cooldowns are cleared separately: they are keyed like attempts but can
    // exist without an attempts entry (interrupt path). A stale cooldown from
    // an already-healed occurrence silently blocked action on a genuinely new
    // recurrence of the same finding — and grew this map without bound.
    for (const id of [...this.cooldowns.keys()]) {
      if (!activeFindingIds.has(id)) this.cooldowns.delete(id);
    }
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
        quietTracker: this.quietTracker,
        structuredSource: this.structuredSource
      });

      const findings = rulesModule.evaluate(signals, this.rules);
      const signalsById = new Map(signals.map((signal) => [signal.sessionId, signal]));
      const conditionsById = new Map(this.rules.conditions.map((condition) => [condition.id, condition]));
      const activeIds = new Set(findings.map((finding) => finding.id));
      this.forgetHealed(activeIds);

      const results = [];
      for (const finding of findings) {
        const condition = conditionsById.get(finding.conditionId);
        const attempts = this.attempts.get(finding.id) || 0;
        const plan = rulesModule.planAction(condition, { autonomy: this.rules.autonomy, attempts });
        const score = scoreUrgency(finding, { policy: this.rules.interruption, attempts, condition });
        const enriched = { ...finding, attempts, urgency: score, intent: plan.intent, planReason: plan.reason };

        if (this.isCoolingDown(finding.id, condition)) {
          results.push({ ...enriched, outcome: 'cooling-down', performed: false });
          continue;
        }
        if (dryRun) {
          results.push({ ...enriched, outcome: 'dry-run', performed: false });
          continue;
        }

        const executed = await this.executor({
          finding,
          plan,
          signal: signalsById.get(finding.sessionId),
          rules: this.rules
        });

        let outcome = executed.outcome;
        let detail = executed.detail;

        if (plan.intent === 'resolve' || plan.intent === 'delegate') {
          this.cooldowns.set(finding.id, Date.now());
          this.attempts.set(finding.id, attempts + 1);
          if (executed.performed) {
            this.stats[plan.intent === 'delegate' ? 'delegated' : 'resolved'] += 1;
          }
        }

        // Either the plan was already to interrupt, or the repair itself failed
        // in a way that cannot be retried usefully.
        const wantsHuman = plan.intent === 'interrupt' || executed.escalate === true;
        if (wantsHuman) {
          const verdict = this.repeatsTooSoon(finding.id)
            ? { allow: false, reason: 'already interrupted about this recently' }
            : this.budget.evaluate(score);

          if (verdict.allow) {
            this.interrupt(enriched, score);
            this.cooldowns.set(finding.id, Date.now());
            outcome = 'interrupted';
            detail = detail || verdict.reason;
          } else {
            this.digest.add(enriched, { score, reason: verdict.reason });
            this.stats.digested += 1;
            outcome = 'digested';
            detail = verdict.reason;
          }
        }

        const entry = { ...enriched, outcome, detail, performed: executed.performed };
        if (outcome !== 'observed') {
          this.appendAudit({
            event: 'finding',
            id: finding.id,
            conditionId: finding.conditionId,
            sessionId: finding.sessionId,
            severity: finding.severity,
            tier: finding.tier,
            urgency: score,
            attempts,
            intent: plan.intent,
            outcome,
            detail
          });
        }

        this.recordFinding(entry);
        results.push(entry);
      }

      this.lastTickAt = new Date().toISOString();
      this.lastTickDurationMs = Date.now() - startedAt;
      this.tickCount += 1;

      if (!dryRun && this.digest.isDue()) this.deliverDigest();

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

  /**
   * One batched interruption instead of a dozen individual ones.
   */
  deliverDigest() {
    const items = this.digest.drain();
    if (!items.length) return null;

    const summary = `${items.length} thing${items.length === 1 ? '' : 's'} waiting: ${items
      .slice(0, 3)
      .map((item) => `${item.where} ${item.label.toLowerCase()}`)
      .join('; ')}${items.length > 3 ? `; and ${items.length - 3} more` : ''}.`;

    this.activityFeed?.track?.('supervisor.digest', { count: items.length, items });
    this.notificationService?.notify?.('supervisor', 'info', summary, { digest: true, count: items.length });
    this.appendAudit({ event: 'digest', count: items.length, items: items.map((item) => item.id) });

    return { summary, items };
  }

  getFindings({ limit = 100, severity = '', sessionId = '', outcome = '' } = {}) {
    const wantSeverity = String(severity || '').toLowerCase();
    const wantSession = String(sessionId || '').trim();
    const wantOutcome = String(outcome || '').trim();
    return this.findings
      .filter((finding) => (!wantSeverity || finding.severity === wantSeverity))
      .filter((finding) => (!wantSession || finding.sessionId === wantSession))
      .filter((finding) => (!wantOutcome || finding.outcome === wantOutcome))
      .slice(0, Math.max(1, Number(limit) || 100));
  }

  /**
   * What the supervisor has been doing, and the short list of things it could
   * not handle. Deliberately leads with "handled" — if that number is high and
   * the waiting list is empty, the system is working.
   */
  getBriefing({ limit = 6 } = {}) {
    const waiting = this.digest.pending().slice(0, Math.max(1, Number(limit) || 6));
    const handled = this.findings.filter((f) => f.outcome === 'resolved' || f.outcome === 'delegated').length;

    return {
      autonomy: this.rules.autonomy,
      running: this.running,
      lastTickAt: this.lastTickAt,
      stats: { ...this.stats },
      handledRecently: handled,
      waiting,
      budget: this.budget.getState(),
      spoken: this.renderSpokenBriefing(waiting, handled)
    };
  }

  renderSpokenBriefing(waiting, handled) {
    if (!this.running) return 'The supervisor is not running.';

    const handledPart = handled
      ? `I handled ${handled} thing${handled === 1 ? '' : 's'} since the last check.`
      : 'Nothing has needed handling.';

    if (!waiting.length) return `${handledPart} Nothing is waiting on you.`;

    const details = waiting
      .slice(0, 3)
      .map((item) => `${item.where}: ${item.label.toLowerCase()}`)
      .join('. ');

    return `${handledPart} ${waiting.length} thing${waiting.length === 1 ? '' : 's'} still need${waiting.length === 1 ? 's' : ''} you. ${details}.`;
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
    for (const { timer } of this.resumeTimers.values()) clearTimeout(timer);
    this.resumeTimers.clear();
    const wasRunning = this.running;
    this.running = false;
    if (wasRunning) this.appendAudit({ event: 'stopped' });
    return { running: false, wasRunning };
  }

  getStatus() {
    return {
      running: this.running,
      autonomy: this.rules.autonomy,
      capabilities: rulesModule.capabilities(this.rules.autonomy),
      tickSeconds: this.rules.tickSeconds,
      rulesSource: this.rules.source,
      conditionCount: this.rules.conditions.length,
      lastTickAt: this.lastTickAt,
      lastTickDurationMs: this.lastTickDurationMs,
      tickCount: this.tickCount,
      stats: { ...this.stats },
      findingCount: this.findings.length,
      digestPending: this.digest.pending().length,
      scheduledResumes: [...this.resumeTimers.entries()].map(([sessionId, entry]) => ({ sessionId, at: entry.at })),
      budget: this.budget.getState(),
      auditPath: this.auditPath(),
      autonomyLevels: rulesModule.AUTONOMY_LEVELS,
      conditions: this.rules.conditions.map((condition) => ({
        id: condition.id,
        label: condition.label,
        severity: condition.severity,
        resolveHandler: condition.resolve?.handler || null,
        escalateAfterAttempts: condition.escalateAfterAttempts,
        cooldownSeconds: condition.cooldownSeconds
      }))
    };
  }
}

module.exports = SupervisorService;
module.exports.SupervisorService = SupervisorService;
module.exports.rules = rulesModule;
