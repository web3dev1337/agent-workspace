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
      recentRuns: this.recentRuns.slice(-50).reverse()
    };
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
