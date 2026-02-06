const fs = require('fs').promises;
const path = require('path');
const os = require('os');

function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toArray(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

class AuditExportService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.activityFeed = null;
    this.schedulerService = null;
    this.userSettingsService = null;
    this.defaultSources = ['activity', 'scheduler'];
  }

  static getInstance(options = {}) {
    if (!AuditExportService.instance) {
      AuditExportService.instance = new AuditExportService(options);
    }
    return AuditExportService.instance;
  }

  init({ activityFeed, schedulerService, userSettingsService } = {}) {
    this.activityFeed = activityFeed || this.activityFeed;
    this.schedulerService = schedulerService || this.schedulerService;
    this.userSettingsService = userSettingsService || this.userSettingsService;
  }

  getConfig() {
    const defaults = {
      maxRecords: 10000,
      redaction: {
        enabled: true,
        emails: true,
        tokens: true,
        homePaths: true
      }
    };
    const fromSettings = this.userSettingsService?.getAllSettings?.()?.global?.audit || {};
    return {
      ...defaults,
      ...(fromSettings && typeof fromSettings === 'object' ? fromSettings : {}),
      redaction: {
        ...defaults.redaction,
        ...((fromSettings && fromSettings.redaction && typeof fromSettings.redaction === 'object')
          ? fromSettings.redaction
          : {})
      }
    };
  }

  parseSources(rawSources) {
    const values = toArray(rawSources).map((source) => String(source || '').trim().toLowerCase());
    const requested = values.length ? values : this.defaultSources;
    const supported = ['activity', 'scheduler'];
    return requested.filter((source, index) => supported.includes(source) && requested.indexOf(source) === index);
  }

  async readJsonl(filePath) {
    if (!filePath) return [];
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const out = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object') out.push(parsed);
        } catch {
          // ignore malformed lines
        }
      }
      return out;
    } catch (error) {
      if (String(error?.code || '') !== 'ENOENT') {
        this.logger.warn?.('Failed to read audit source file', { filePath, error: error.message });
      }
      return [];
    }
  }

  normalizeActivityEvent(event) {
    const tsRaw = Number(event?.ts);
    const ts = Number.isFinite(tsRaw) ? tsRaw : Date.parse(String(event?.at || ''));
    const at = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
    return {
      at,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      source: 'activity',
      kind: String(event?.kind || 'activity'),
      data: event?.data && typeof event.data === 'object'
        ? event.data
        : { value: event?.data ?? null }
    };
  }

  normalizeSchedulerEvent(event) {
    const ts = Date.parse(String(event?.at || ''));
    const copy = {
      ...event
    };
    delete copy.at;
    return {
      at: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
      ts: Number.isFinite(ts) ? ts : Date.now(),
      source: 'scheduler',
      kind: 'scheduler.run',
      data: copy
    };
  }

  redactString(value, options = {}) {
    let out = String(value ?? '');

    if (options.homePaths !== false) {
      const home = String(os.homedir() || '').replace(/\\/g, '/');
      if (home) {
        const normalized = out.replace(/\\/g, '/');
        out = normalized.split(home).join('~');
      }
      const userProfile = String(process.env.USERPROFILE || '').replace(/\\/g, '/');
      if (userProfile) {
        const normalized = out.replace(/\\/g, '/');
        out = normalized.split(userProfile).join('~');
      }
    }

    if (options.emails !== false) {
      out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
    }

    if (options.tokens !== false) {
      out = out
        .replace(/([?&](?:token|auth|apikey|api_key|key)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, '[REDACTED_TOKEN]')
        .replace(/\b(?:bearer\s+)[A-Za-z0-9._-]{16,}\b/gi, 'bearer [REDACTED_TOKEN]');
    }

    return out;
  }

  redactValue(value, options = {}, keyPath = '') {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item, index) => this.redactValue(item, options, `${keyPath}[${index}]`));
    }

    if (typeof value === 'object') {
      const out = {};
      for (const [key, val] of Object.entries(value)) {
        const keyLower = String(key || '').toLowerCase();
        const isSensitiveKey = /(token|secret|password|api[-_]?key|auth|cookie|signature|license)/i.test(keyLower);
        if (isSensitiveKey) {
          out[key] = '[REDACTED]';
          continue;
        }
        out[key] = this.redactValue(val, options, keyPath ? `${keyPath}.${key}` : key);
      }
      return out;
    }

    if (typeof value === 'string') {
      return this.redactString(value, options);
    }

    return value;
  }

  async collectRecords({ sources, sinceMs, limit } = {}) {
    const selected = this.parseSources(sources);
    const records = [];

    if (selected.includes('activity')) {
      const filePath = this.activityFeed?.filePath;
      const rows = await this.readJsonl(filePath);
      for (const row of rows) {
        records.push(this.normalizeActivityEvent(row));
      }
    }

    if (selected.includes('scheduler')) {
      const filePath = this.schedulerService?.auditPath;
      const rows = await this.readJsonl(filePath);
      for (const row of rows) {
        records.push(this.normalizeSchedulerEvent(row));
      }
    }

    const since = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : 0;
    const filtered = records
      .filter((record) => (Number(record.ts) || 0) >= since)
      .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    const lim = clampInt(limit, { min: 1, max: 200000, fallback: 10000 });
    if (filtered.length > lim) return filtered.slice(filtered.length - lim);
    return filtered;
  }

  async exportJson({ sources, sinceMs, limit, redact } = {}) {
    const cfg = this.getConfig();
    const maxRecords = clampInt(limit, {
      min: 1,
      max: 200000,
      fallback: clampInt(cfg.maxRecords, { min: 1, max: 200000, fallback: 10000 })
    });
    const records = await this.collectRecords({ sources, sinceMs, limit: maxRecords });

    const shouldRedact = redact === undefined ? cfg.redaction.enabled !== false : redact !== false;
    const redactedRecords = shouldRedact
      ? records.map((record) => this.redactValue(record, cfg.redaction))
      : records;

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      count: redactedRecords.length,
      sources: this.parseSources(sources),
      redacted: shouldRedact,
      records: redactedRecords
    };
  }

  toCsv(records = []) {
    const lines = ['at,source,kind,data'];
    for (const record of records) {
      lines.push([
        csvEscape(record?.at || ''),
        csvEscape(record?.source || ''),
        csvEscape(record?.kind || ''),
        csvEscape(JSON.stringify(record?.data || {}))
      ].join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  async exportCsv(options = {}) {
    const payload = await this.exportJson(options);
    return {
      ...payload,
      csv: this.toCsv(payload.records)
    };
  }

  async getStatus() {
    const activityPath = this.activityFeed?.filePath || null;
    const schedulerPath = this.schedulerService?.auditPath || null;
    const [activityRows, schedulerRows] = await Promise.all([
      this.readJsonl(activityPath),
      this.readJsonl(schedulerPath)
    ]);
    return {
      ok: true,
      config: this.getConfig(),
      sources: {
        activity: { path: activityPath, count: activityRows.length },
        scheduler: { path: schedulerPath, count: schedulerRows.length }
      }
    };
  }
}

module.exports = { AuditExportService };
