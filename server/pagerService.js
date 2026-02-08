class PagerService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.sessionManager = null;
    this.userSettingsService = null;
    this.taskRecordService = null;
    this.jobs = new Map();
    this.timers = new Map();
    this.maxRecent = 200;
    this.recent = [];
  }

  static getInstance(options = {}) {
    if (!PagerService.instance) {
      PagerService.instance = new PagerService(options);
    }
    return PagerService.instance;
  }

  init({ sessionManager, userSettingsService, taskRecordService } = {}) {
    this.sessionManager = sessionManager || this.sessionManager;
    this.userSettingsService = userSettingsService || this.userSettingsService;
    this.taskRecordService = taskRecordService || this.taskRecordService;
  }

  getBuiltInProfile() {
    return {
      nudgeText: 'next',
      intervalSeconds: 300,
      enterDelayMs: 1000,
      maxPings: 24,
      maxRuntimeMinutes: 120,
      customInstruction: '',
      customInstructionMode: 'append',
      doneCheck: {
        enabled: false,
        token: 'PAGER_DONE',
        prompt: 'If you are 100% done with all requested work, reply exactly: PAGER_DONE and then stop.'
      }
    };
  }

  getGlobalProfileTemplate() {
    const defaults = this.getBuiltInProfile();
    const globalPager = this.userSettingsService?.getAllSettings?.()?.global?.pager;
    const source = (globalPager && typeof globalPager === 'object') ? globalPager : {};
    const doneCheck = (source.doneCheck && typeof source.doneCheck === 'object') ? source.doneCheck : {};
    return {
      ...defaults,
      ...source,
      customInstruction: String(source.customInstruction || defaults.customInstruction || '').trim(),
      customInstructionMode: String(source.customInstructionMode || defaults.customInstructionMode || 'append').trim().toLowerCase() === 'replace'
        ? 'replace'
        : 'append',
      doneCheck: {
        ...defaults.doneCheck,
        ...doneCheck
      }
    };
  }

  getDefaultProfile() {
    return this.getGlobalProfileTemplate();
  }

  normalizeInt(value, fallback, min, max) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    const rounded = Math.round(next);
    if (Number.isFinite(min) && rounded < min) return min;
    if (Number.isFinite(max) && rounded > max) return max;
    return rounded;
  }

  sanitizeJobId(value) {
    const raw = String(value || '').trim().toLowerCase();
    const safe = raw.replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return safe || null;
  }

  allocateJobId(preferred) {
    const base = this.sanitizeJobId(preferred) || `pager-${Date.now().toString(36)}`;
    if (!this.jobs.has(base)) return base;
    let idx = 2;
    while (this.jobs.has(`${base}-${idx}`)) idx += 1;
    return `${base}-${idx}`;
  }

  getAllSessionsMap() {
    const out = new Map();
    const addMap = (map) => {
      if (!(map instanceof Map)) return;
      for (const [id, session] of map.entries()) {
        if (!id || !session) continue;
        out.set(id, session);
      }
    };

    addMap(this.sessionManager?.sessions);
    const byWorkspace = this.sessionManager?.workspaceSessionMaps;
    if (byWorkspace instanceof Map) {
      for (const map of byWorkspace.values()) addMap(map);
    }
    return out;
  }

  normalizeTierSet(input) {
    const values = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/g);
    const out = [];
    for (const value of values) {
      const num = Number(String(value || '').trim());
      if (!Number.isFinite(num)) continue;
      const tier = Math.round(num);
      if (tier >= 1 && tier <= 4 && !out.includes(tier)) out.push(tier);
    }
    return out.sort((a, b) => a - b);
  }

  resolveTargets(input = {}) {
    const all = this.getAllSessionsMap();
    const ids = new Set();
    const tiers = this.normalizeTierSet(input.tiers || input.tierSet || input.tier);

    if (Array.isArray(input.sessionIds)) {
      for (const row of input.sessionIds) {
        const id = String(row || '').trim();
        if (id) ids.add(id);
      }
    }

    if (!ids.size && input.sessionId) {
      const id = String(input.sessionId || '').trim();
      if (id) ids.add(id);
    }

    if (!ids.size && input.workspaceId) {
      const workspaceId = String(input.workspaceId || '').trim();
      const typeFilter = String(input.type || 'claude').trim().toLowerCase();
      for (const [id, session] of all.entries()) {
        if (String(session?.workspace || '').trim() !== workspaceId) continue;
        if (typeFilter && String(session?.type || '').trim().toLowerCase() !== typeFilter) continue;
        ids.add(id);
      }
    }

    if (!ids.size) {
      throw new Error('No target sessions resolved (provide sessionId, sessionIds, or workspaceId)');
    }

    const valid = [];
    const missing = [];
    const filtered = [];
    for (const id of ids) {
      const session = this.sessionManager?.getSessionById?.(id);
      if (!session || !session.pty) {
        missing.push(id);
        continue;
      }
      if (tiers.length) {
        const record = this.taskRecordService?.get?.(`session:${id}`) || null;
        const sessionTier = Number(record?.tier);
        if (!Number.isFinite(sessionTier) || !tiers.includes(Math.round(sessionTier))) {
          filtered.push(id);
          continue;
        }
      }
      valid.push(id);
    }

    if (!valid.length) {
      if (tiers.length) {
        throw new Error(`No live sessions found for targets after tier filter [${tiers.join(', ')}]`);
      }
      throw new Error(`No live sessions found for targets: ${missing.join(', ') || '(none)'}`);
    }

    return {
      sessionIds: valid,
      missingSessionIds: missing,
      filteredSessionIds: filtered,
      tiers
    };
  }

  buildProfile(options = {}) {
    const defaults = this.getDefaultProfile();
    const doneCheckIn = (options.doneCheck && typeof options.doneCheck === 'object') ? options.doneCheck : {};
    const doneCheckEnabledRaw = options.doneCheckEnabled;
    const doneCheckEnabled = doneCheckEnabledRaw === undefined
      ? (doneCheckIn.enabled === true)
      : (doneCheckEnabledRaw === true || String(doneCheckEnabledRaw).toLowerCase() === 'true');
    const customInstructionMode = String(options.customInstructionMode || defaults.customInstructionMode || 'append').trim().toLowerCase() === 'replace'
      ? 'replace'
      : 'append';
    const defaultInstruction = String(defaults.customInstruction || '').trim();
    const jobInstruction = String(options.customInstruction || '').trim();
    const customInstruction = customInstructionMode === 'replace'
      ? jobInstruction
      : [defaultInstruction, jobInstruction].filter(Boolean).join(' ').trim();

    return {
      nudgeText: String(options.nudgeText || defaults.nudgeText || 'next').trim() || 'next',
      intervalSeconds: this.normalizeInt(options.intervalSeconds, defaults.intervalSeconds, 5, 3600),
      enterDelayMs: this.normalizeInt(options.enterDelayMs, defaults.enterDelayMs, 100, 10000),
      maxPings: this.normalizeInt(options.maxPings, defaults.maxPings, 1, 100000),
      maxRuntimeMinutes: this.normalizeInt(options.maxRuntimeMinutes, defaults.maxRuntimeMinutes, 1, 10080),
      customInstruction,
      customInstructionMode,
      doneCheck: {
        enabled: doneCheckEnabled,
        token: String(doneCheckIn.token || options.doneToken || defaults.doneCheck.token || 'PAGER_DONE').trim() || 'PAGER_DONE',
        prompt: String(doneCheckIn.prompt || options.donePrompt || defaults.doneCheck.prompt || '').trim()
      }
    };
  }

  getSessionBufferDelta(job, sessionId, session) {
    const raw = String(session?.buffer || '');
    const cursors = (job.cursors && typeof job.cursors === 'object') ? job.cursors : {};
    let cursor = Number(cursors[sessionId] || 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
    if (cursor > raw.length) cursor = raw.length;
    const delta = raw.slice(cursor);
    cursors[sessionId] = raw.length;
    job.cursors = cursors;
    return delta;
  }

  appendAudit(event) {
    const row = {
      at: new Date().toISOString(),
      ...event
    };
    this.recent.push(row);
    if (this.recent.length > this.maxRecent) {
      this.recent = this.recent.slice(-this.maxRecent);
    }
  }

  getJobSnapshot(job) {
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      stoppedAt: job.stoppedAt,
      stopReason: job.stopReason,
      sessionIds: Array.isArray(job.sessionIds) ? [...job.sessionIds] : [],
      missingSessionIds: Array.isArray(job.missingSessionIds) ? [...job.missingSessionIds] : [],
      filteredSessionIds: Array.isArray(job.filteredSessionIds) ? [...job.filteredSessionIds] : [],
      targetTiers: Array.isArray(job.targetTiers) ? [...job.targetTiers] : [],
      profile: { ...job.profile, doneCheck: { ...(job.profile?.doneCheck || {}) } },
      pingsSent: Number(job.pingsSent || 0),
      runCount: Number(job.runCount || 0),
      consecutiveFailures: Number(job.consecutiveFailures || 0),
      lastPingAt: job.lastPingAt || null,
      nextRunAt: job.nextRunAt || null,
      lastError: job.lastError || null,
      doneSessionId: job.doneSessionId || null,
      doneToken: job.doneToken || null
    };
  }

  getStatus({ id } = {}) {
    if (id) {
      const job = this.jobs.get(String(id || '').trim());
      return {
        ok: true,
        defaults: this.getDefaultProfile(),
        job: this.getJobSnapshot(job),
        recent: this.recent.slice(-50).reverse()
      };
    }

    const jobs = Array.from(this.jobs.values())
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((job) => this.getJobSnapshot(job));

    const running = jobs.filter((j) => j.status === 'running').length;
    return {
      ok: true,
      defaults: this.getDefaultProfile(),
      running,
      count: jobs.length,
      jobs,
      recent: this.recent.slice(-50).reverse()
    };
  }

  async sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  composeNudgeText(profile) {
    const parts = [String(profile.nudgeText || '').trim() || 'next'];
    if (profile.customInstruction) parts.push(profile.customInstruction);
    return parts.join(' ').trim();
  }

  async writeTwoStep(sessionId, text, enterDelayMs) {
    const first = this.sessionManager?.writeToSession?.(sessionId, text);
    if (!first) return false;
    await this.sleep(enterDelayMs);
    const second = this.sessionManager?.writeToSession?.(sessionId, '\r');
    return !!second;
  }

  stopJob(id, { reason = 'manual', doneSessionId = null, doneToken = null } = {}) {
    const jobId = String(id || '').trim();
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: false, error: `Job not found: ${jobId}` };
    }

    if (this.timers.has(jobId)) {
      clearTimeout(this.timers.get(jobId));
      this.timers.delete(jobId);
    }

    job.status = 'stopped';
    job.stoppedAt = new Date().toISOString();
    job.stopReason = String(reason || 'manual');
    job.doneSessionId = doneSessionId || job.doneSessionId || null;
    job.doneToken = doneToken || job.doneToken || null;
    job.nextRunAt = null;

    this.appendAudit({
      kind: 'pager.stop',
      jobId,
      reason: job.stopReason,
      doneSessionId: job.doneSessionId || null
    });

    return { ok: true, job: this.getJobSnapshot(job) };
  }

  scheduleNext(job) {
    const jobId = job.id;
    if (job.status !== 'running') return;
    const delayMs = Math.max(1000, Number(job.profile.intervalSeconds || 300) * 1000);
    job.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    if (this.timers.has(jobId)) {
      clearTimeout(this.timers.get(jobId));
    }
    const timer = setTimeout(() => {
      this.tickJob(jobId).catch((error) => {
        this.logger.error?.('Pager tick failed', { jobId, error: error.message, stack: error.stack });
        const current = this.jobs.get(jobId);
        if (current) {
          current.lastError = String(error?.message || error);
          this.stopJob(jobId, { reason: 'tick-error' });
        }
      });
    }, delayMs);
    this.timers.set(jobId, timer);
  }

  async tickJob(id) {
    const jobId = String(id || '').trim();
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') return;

    const now = Date.now();
    const maxRuntimeMs = Math.max(1, Number(job.profile.maxRuntimeMinutes || 120)) * 60_000;
    if ((now - job.startedAtMs) >= maxRuntimeMs) {
      this.stopJob(jobId, { reason: 'max-runtime-reached' });
      return;
    }

    const live = [];
    for (const sessionId of job.sessionIds) {
      const session = this.sessionManager?.getSessionById?.(sessionId);
      if (!session || !session.pty || session.status === 'exited' || session.status === 'dead') continue;
      live.push({ sessionId, session });
    }

    if (!live.length) {
      this.stopJob(jobId, { reason: 'no-live-sessions' });
      return;
    }

    if (job.profile.doneCheck?.enabled) {
      const token = String(job.profile.doneCheck.token || '').trim();
      if (token) {
        for (const row of live) {
          const delta = this.getSessionBufferDelta(job, row.sessionId, row.session);
          if (delta && delta.includes(token)) {
            this.stopJob(jobId, {
              reason: 'done-token-detected',
              doneSessionId: row.sessionId,
              doneToken: token
            });
            return;
          }
        }
      }
    }

    const message = this.composeNudgeText(job.profile);
    let successCount = 0;
    const errors = [];
    for (const row of live) {
      try {
        const ok = await this.writeTwoStep(row.sessionId, message, job.profile.enterDelayMs);
        if (ok) {
          successCount += 1;
        } else {
          errors.push(`${row.sessionId}:write-failed`);
        }
      } catch (error) {
        errors.push(`${row.sessionId}:${String(error?.message || error)}`);
      }
    }

    job.runCount = Number(job.runCount || 0) + 1;
    if (successCount > 0) {
      job.pingsSent = Number(job.pingsSent || 0) + 1;
      job.consecutiveFailures = 0;
      job.lastError = null;
      job.lastPingAt = new Date().toISOString();
    } else {
      job.consecutiveFailures = Number(job.consecutiveFailures || 0) + 1;
      job.lastError = errors.join('; ') || 'all writes failed';
    }

    this.appendAudit({
      kind: 'pager.tick',
      jobId,
      successCount,
      targetCount: live.length,
      errors: errors.slice(0, 10)
    });

    if (job.consecutiveFailures >= 3) {
      this.stopJob(jobId, { reason: 'consecutive-write-failures' });
      return;
    }

    if (job.pingsSent >= job.profile.maxPings) {
      this.stopJob(jobId, { reason: 'max-pings-reached' });
      return;
    }

    this.scheduleNext(job);
  }

  async sendDonePrompt(job) {
    if (!job?.profile?.doneCheck?.enabled) return;
    const prompt = String(job.profile.doneCheck.prompt || '').trim();
    if (!prompt) return;

    for (const sessionId of job.sessionIds) {
      const session = this.sessionManager?.getSessionById?.(sessionId);
      if (!session || !session.pty) continue;
      try {
        await this.writeTwoStep(sessionId, prompt, job.profile.enterDelayMs);
      } catch {
        // ignore prompt failures
      }
    }
  }

  async startJob(options = {}) {
    if (!this.sessionManager) {
      throw new Error('Pager not initialized');
    }

    const profile = this.buildProfile(options);
    const target = this.resolveTargets(options);
    const id = this.allocateJobId(options.id);

    const job = {
      id,
      status: 'running',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      stoppedAt: null,
      stopReason: null,
      sessionIds: target.sessionIds,
      missingSessionIds: target.missingSessionIds,
      filteredSessionIds: target.filteredSessionIds,
      targetTiers: target.tiers,
      profile,
      pingsSent: 0,
      runCount: 0,
      consecutiveFailures: 0,
      lastPingAt: null,
      nextRunAt: null,
      lastError: null,
      cursors: {},
      doneSessionId: null,
      doneToken: null
    };

    this.jobs.set(id, job);
    this.appendAudit({ kind: 'pager.start', jobId: id, sessionCount: job.sessionIds.length });

    if (job.profile.doneCheck.enabled) {
      await this.sendDonePrompt(job);
    }

    await this.tickJob(id);

    return this.getJobSnapshot(this.jobs.get(id));
  }
}

module.exports = { PagerService };
