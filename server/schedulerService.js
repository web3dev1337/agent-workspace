const fs = require('fs');
const path = require('path');

class SchedulerService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.userSettingsService = null;
    this.commandRegistry = null;
    this.timer = null;
    this.runningIds = new Set();
    this.recentRuns = [];
    this.maxRecentRuns = 200;
    this.auditPath = this.resolveAuditPath();
  }

  static getInstance(options = {}) {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService(options);
    }
    return SchedulerService.instance;
  }

  resolveAuditPath() {
    const dataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    const baseDir = dataDirRaw ? path.resolve(dataDirRaw) : path.join(__dirname, '..');
    const logsDir = path.join(baseDir, 'logs');
    try {
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    } catch {
      // ignore
    }
    return path.join(logsDir, 'scheduler-audit.log');
  }

  getDefaultConfig() {
    return {
      enabled: false,
      tickSeconds: 30,
      safety: {
        defaultMode: 'safe',
        blockedCommandPatterns: [
          'queue-merge',
          'queue-request-changes',
          'queue-approve',
          'stop-session',
          'kill-session',
          'destroy-session',
          'remove-worktree'
        ]
      },
      schedules: []
    };
  }

  init({ userSettingsService, commandRegistry } = {}) {
    this.userSettingsService = userSettingsService || this.userSettingsService;
    this.commandRegistry = commandRegistry || this.commandRegistry;
    this.start();
  }

  start() {
    this.stop();
    const tickMs = this.getTickMs();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error?.('Scheduler tick failed', { error: error.message, stack: error.stack });
      });
    }, tickMs);
    this.logger.info?.('Scheduler started', { tickMs });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTickMs() {
    const cfg = this.getConfig();
    const secs = Number(cfg?.tickSeconds);
    if (Number.isFinite(secs) && secs >= 5) return Math.round(secs * 1000);
    return 30_000;
  }

  getConfig() {
    const defaults = this.getDefaultConfig();
    const fromSettings = this.userSettingsService?.getAllSettings?.()?.global?.scheduler || {};
    const next = {
      ...defaults,
      ...fromSettings,
      safety: {
        ...defaults.safety,
        ...(fromSettings?.safety || {})
      }
    };
    const schedules = Array.isArray(next.schedules) ? next.schedules : [];
    next.schedules = schedules.map((item, index) => this.normalizeSchedule(item, index)).filter(Boolean);
    return next;
  }

  normalizeSchedule(schedule, index = 0) {
    if (!schedule || typeof schedule !== 'object') return null;
    const idRaw = String(schedule.id || `schedule-${index + 1}`).trim().toLowerCase();
    const id = idRaw.replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!id) return null;
    const intervalMinutes = Number(schedule.intervalMinutes);
    const interval = Number.isFinite(intervalMinutes) && intervalMinutes > 0
      ? Math.round(intervalMinutes)
      : 30;
    return {
      id,
      name: String(schedule.name || id).trim(),
      enabled: schedule.enabled !== false,
      intervalMinutes: interval,
      command: String(schedule.command || '').trim(),
      params: (schedule.params && typeof schedule.params === 'object') ? schedule.params : {},
      safetyMode: String(schedule.safetyMode || '').trim().toLowerCase() || null,
      allowDangerous: schedule.allowDangerous === true,
      nextRunAt: String(schedule.nextRunAt || '').trim() || null,
      lastRunAt: String(schedule.lastRunAt || '').trim() || null,
      lastStatus: String(schedule.lastStatus || '').trim() || null,
      lastMessage: String(schedule.lastMessage || '').trim() || null
    };
  }

  async updateConfig(patch = {}) {
    if (!this.userSettingsService || typeof this.userSettingsService.updateGlobalSettings !== 'function') {
      throw new Error('Scheduler not initialized');
    }
    const settings = this.userSettingsService.getAllSettings();
    const global = settings?.global || {};
    const current = this.getConfig();
    const next = {
      ...current,
      ...(patch && typeof patch === 'object' ? patch : {}),
      safety: {
        ...(current.safety || {}),
        ...((patch && patch.safety && typeof patch.safety === 'object') ? patch.safety : {})
      }
    };
    if (patch.schedules !== undefined) {
      next.schedules = (Array.isArray(patch.schedules) ? patch.schedules : [])
        .map((item, idx) => this.normalizeSchedule(item, idx))
        .filter(Boolean);
    }

    global.scheduler = next;
    const ok = this.userSettingsService.updateGlobalSettings(global);
    if (!ok) throw new Error('Failed to persist scheduler config');
    this.start();
    return this.getConfig();
  }

  getStatus() {
    const cfg = this.getConfig();
    return {
      ok: true,
      running: !!this.timer,
      tickMs: this.getTickMs(),
      config: cfg,
      templates: this.getTemplates(),
      recentRuns: this.recentRuns.slice(-50).reverse()
    };
  }

  getTemplates() {
    return [
      {
        id: 'review-route-sweep',
        name: 'Review Route Sweep',
        category: 'review',
        risk: 'safe',
        description: 'Open the review route and refresh the queue context.',
        defaults: {
          intervalMinutes: 30,
          command: 'open-review-route',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'stuck-session-nudge',
        name: 'Stuck Session Nudge',
        category: 'review',
        risk: 'safe',
        description: 'Open blockers view to surface stalled sessions quickly.',
        defaults: {
          intervalMinutes: 45,
          command: 'queue-blockers',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'stuck-task-check',
        name: 'Stuck Task Check',
        category: 'review',
        risk: 'safe',
        description: 'Legacy alias for stuck-session-nudge.',
        defaults: {
          intervalMinutes: 45,
          command: 'queue-blockers',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'dependency-blocked-report',
        name: 'Dependency Blocked Report',
        category: 'review',
        risk: 'safe',
        description: 'Open queue triage focused on dependency issues.',
        defaults: {
          intervalMinutes: 60,
          command: 'queue-triage',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'daily-health-digest',
        name: 'Daily Health Digest',
        category: 'health',
        risk: 'safe',
        description: 'Open advisor health dashboard on a daily cadence.',
        defaults: {
          intervalMinutes: 1440,
          command: 'open-advice',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'health-snapshot',
        name: 'Health Snapshot',
        category: 'health',
        risk: 'safe',
        description: 'Open advice/health context to review project readiness.',
        defaults: {
          intervalMinutes: 90,
          command: 'open-advice',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'queue-conveyor-t3',
        name: 'Queue Conveyor T3',
        category: 'review',
        risk: 'safe',
        description: 'Advance to the next T3 review item in queue conveyor mode.',
        defaults: {
          intervalMinutes: 30,
          command: 'queue-conveyor-t3',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'discord-queue-cadence',
        name: 'Discord Queue Cadence',
        category: 'integration',
        risk: 'caution',
        description: 'Trigger Discord queue processing in the Services workspace.',
        defaults: {
          intervalMinutes: 20,
          command: 'discord-process-queue',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'workspace-refresh-snapshot',
        name: 'Workspace Refresh Snapshot',
        category: 'maintenance',
        risk: 'safe',
        description: 'Refresh branches, ports, and terminal visibility across sessions.',
        defaults: {
          intervalMinutes: 60,
          command: 'refresh-all',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      },
      {
        id: 'pr-review-poll',
        name: 'PR Review Poll',
        category: 'review',
        risk: 'caution',
        description: 'Scan for new PRs and completed reviews, auto-spawn reviewer agents.',
        defaults: {
          intervalMinutes: 1,
          command: 'pr-review-poll',
          params: {},
          safetyMode: 'safe',
          enabled: false
        }
      }
    ];
  }

  allocateScheduleId(baseId, existingIds = new Set()) {
    const root = String(baseId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `schedule-${Date.now()}`;

    let candidate = root;
    let idx = 2;
    while (existingIds.has(candidate)) {
      candidate = `${root}-${idx}`;
      idx += 1;
    }
    return candidate;
  }

  resolveTemplate(templateId) {
    const id = String(templateId || '').trim();
    if (!id) throw new Error('templateId is required');
    const template = this.getTemplates().find((item) => String(item.id || '') === id);
    if (!template) throw new Error(`Unknown scheduler template: ${id}`);
    return template;
  }

  buildScheduleFromTemplate(templateId, options = {}) {
    const template = this.resolveTemplate(templateId);
    const cfg = this.getConfig();
    const existingIds = new Set((Array.isArray(cfg.schedules) ? cfg.schedules : []).map((schedule) => String(schedule?.id || '').trim()));
    const base = template.defaults || {};
    const nowIso = new Date().toISOString();
    const intervalMinutes = Number(options.intervalMinutes);
    const nextIntervalMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0
      ? Math.round(intervalMinutes)
      : Number(base.intervalMinutes || 30);

    const rawSchedule = {
      id: this.allocateScheduleId(String(options.id || `${template.id}-${Date.now()}`), existingIds),
      name: String(options.name || template.name || template.id),
      enabled: options.enabled === true ? true : base.enabled === true,
      intervalMinutes: nextIntervalMinutes,
      command: String(options.command || base.command || '').trim(),
      params: {
        ...(base.params && typeof base.params === 'object' ? base.params : {}),
        ...(options.params && typeof options.params === 'object' ? options.params : {})
      },
      safetyMode: String(options.safetyMode || base.safetyMode || '').trim() || null,
      allowDangerous: options.allowDangerous === true,
      nextRunAt: options.nextRunAt || null,
      lastRunAt: null,
      lastStatus: null,
      lastMessage: null
    };

    if (rawSchedule.enabled && !rawSchedule.nextRunAt) {
      rawSchedule.nextRunAt = this.computeNextRunAt(nowIso, rawSchedule.intervalMinutes);
    }

    const schedule = this.normalizeSchedule(rawSchedule, cfg.schedules.length);
    if (!schedule) throw new Error('Failed to normalize schedule from template');

    const safety = this.isCommandAllowed(schedule, cfg);
    const command =
      (this.commandRegistry && typeof this.commandRegistry.getCommand === 'function')
        ? this.commandRegistry.getCommand(schedule.command)
        : null;

    return {
      cfg,
      nowIso,
      template,
      schedule,
      safety,
      command
    };
  }

  async previewScheduleFromTemplate(templateId, options = {}) {
    const built = this.buildScheduleFromTemplate(templateId, options);
    return {
      template: built.template,
      schedule: built.schedule,
      safety: built.safety,
      command: built.command || null
    };
  }

  async createScheduleFromTemplate(templateId, options = {}) {
    const built = this.buildScheduleFromTemplate(templateId, options);
    const { cfg, nowIso, template, schedule } = built;

    const nextSchedules = (Array.isArray(cfg.schedules) ? cfg.schedules : []).concat([schedule]);
    const config = await this.updateConfig({ schedules: nextSchedules });
    const persisted = (Array.isArray(config.schedules) ? config.schedules : []).find((item) => item.id === schedule.id) || schedule;

    this.appendAudit({
      at: nowIso,
      scheduleId: persisted.id,
      command: persisted.command,
      manual: true,
      ok: true,
      message: `created-from-template:${template.id}`
    });

    return { template, schedule: persisted, config };
  }

  isCommandAllowed(schedule, cfg) {
    const command = String(schedule?.command || '').trim().toLowerCase();
    if (!command) {
      return { ok: false, reason: 'Missing command' };
    }

    const mode = String(schedule?.safetyMode || cfg?.safety?.defaultMode || 'safe').trim().toLowerCase();
    if (mode === 'unsafe' || schedule?.allowDangerous === true) {
      return { ok: true };
    }

    const blockedPatterns = Array.isArray(cfg?.safety?.blockedCommandPatterns)
      ? cfg.safety.blockedCommandPatterns
      : [];
    const blocked = blockedPatterns.some((pattern) => {
      const p = String(pattern || '').trim().toLowerCase();
      if (!p) return false;
      return command.includes(p);
    });
    if (blocked) {
      return { ok: false, reason: `Blocked by safety policy (${command})` };
    }
    return { ok: true };
  }

  computeNextRunAt(nowIso, intervalMinutes) {
    const nowMs = Date.parse(String(nowIso || ''));
    const base = Number.isFinite(nowMs) ? nowMs : Date.now();
    return new Date(base + (Math.max(1, Number(intervalMinutes) || 1) * 60_000)).toISOString();
  }

  appendAudit(entry) {
    const row = {
      ...entry,
      at: entry?.at || new Date().toISOString()
    };
    this.recentRuns.push(row);
    if (this.recentRuns.length > this.maxRecentRuns) {
      this.recentRuns = this.recentRuns.slice(-this.maxRecentRuns);
    }
    try {
      fs.appendFileSync(this.auditPath, `${JSON.stringify(row)}\n`);
    } catch {
      // ignore
    }
  }

  async runNow(scheduleId) {
    const id = String(scheduleId || '').trim();
    if (!id) throw new Error('scheduleId is required');
    const cfg = this.getConfig();
    const schedule = cfg.schedules.find((item) => String(item.id || '') === id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    if (!schedule.command) throw new Error(`Schedule ${id} has no command`);
    const result = await this.executeSchedule(schedule, cfg, { manual: true });
    return result;
  }

  async tick() {
    const cfg = this.getConfig();
    if (!cfg.enabled) return;

    let schedules = cfg.schedules;
    if (!Array.isArray(schedules) || schedules.length === 0) return;

    const nowIso = new Date().toISOString();
    let changed = false;
    for (let i = 0; i < schedules.length; i += 1) {
      const schedule = schedules[i];
      if (!schedule?.enabled) continue;
      if (!schedule?.command) continue;
      if (this.runningIds.has(schedule.id)) continue;

      const nextMs = Date.parse(String(schedule.nextRunAt || ''));
      const due = !Number.isFinite(nextMs) || nextMs <= Date.now();
      if (!due) continue;

      changed = true;
      schedules[i] = {
        ...schedule,
        nextRunAt: this.computeNextRunAt(nowIso, schedule.intervalMinutes)
      };
      await this.executeSchedule(schedules[i], cfg, { manual: false });
    }

    if (changed) {
      await this.updateConfig({ schedules });
    }
  }

  async executeSchedule(schedule, cfg, { manual = false } = {}) {
    const id = String(schedule?.id || '').trim();
    if (!id) throw new Error('Invalid schedule id');
    if (!this.commandRegistry || typeof this.commandRegistry.execute !== 'function') {
      throw new Error('Command registry unavailable');
    }
    const command = String(schedule.command || '').trim();
    if (!command) throw new Error(`Schedule ${id} has no command`);

    const safety = this.isCommandAllowed(schedule, cfg);
    if (!safety.ok) {
      const blocked = {
        ok: false,
        scheduleId: id,
        command,
        reason: safety.reason,
        blocked: true
      };
      this.appendAudit({
        at: new Date().toISOString(),
        scheduleId: id,
        command,
        manual: !!manual,
        ok: false,
        blocked: true,
        message: safety.reason
      });
      return blocked;
    }

    this.runningIds.add(id);
    const startedAt = new Date().toISOString();
    try {
      const result = await this.commandRegistry.execute(command, schedule.params || {});
      const ok = result?.success !== false;
      const message = ok ? 'executed' : String(result?.error || 'failed');
      this.appendAudit({
        at: startedAt,
        scheduleId: id,
        command,
        manual: !!manual,
        ok,
        message
      });
      await this.touchScheduleResult(id, {
        lastRunAt: startedAt,
        lastStatus: ok ? 'ok' : 'error',
        lastMessage: message
      });
      return { ok, scheduleId: id, command, result };
    } catch (error) {
      const message = String(error?.message || error);
      this.appendAudit({
        at: startedAt,
        scheduleId: id,
        command,
        manual: !!manual,
        ok: false,
        message
      });
      await this.touchScheduleResult(id, {
        lastRunAt: startedAt,
        lastStatus: 'error',
        lastMessage: message
      });
      return { ok: false, scheduleId: id, command, error: message };
    } finally {
      this.runningIds.delete(id);
    }
  }

  async touchScheduleResult(scheduleId, patch = {}) {
    const id = String(scheduleId || '').trim();
    if (!id) return;
    const cfg = this.getConfig();
    const nextSchedules = cfg.schedules.map((schedule) => {
      if (String(schedule?.id || '') !== id) return schedule;
      return { ...schedule, ...patch };
    });
    await this.updateConfig({ schedules: nextSchedules });
  }
}

module.exports = { SchedulerService };
