const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/task-records.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const DEFAULT_PATH = path.join(os.homedir(), '.orchestrator', 'task-records.json');

const clamp01 = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
};

const normalizeTier = (tier) => {
  const t = Number(tier);
  if (!Number.isFinite(t)) return null;
  const rounded = Math.round(t);
  if (rounded < 1 || rounded > 4) return null;
  return rounded;
};

const normalizeRisk = (risk) => {
  const r = String(risk || '').trim().toLowerCase();
  if (!r) return null;
  const allowed = new Set(['low', 'medium', 'high', 'critical']);
  return allowed.has(r) ? r : null;
};

const normalizeVisibility = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const allowed = new Set(['private', 'shared', 'encrypted']);
  return allowed.has(s) ? s : null;
};

class TaskRecordService {
  constructor({ filePath } = {}) {
    this.filePath = filePath || DEFAULT_PATH;
    this.data = this.load();
  }

  static getInstance() {
    if (!TaskRecordService.instance) {
      TaskRecordService.instance = new TaskRecordService();
    }
    return TaskRecordService.instance;
  }

  load() {
    try {
      if (fsSync.existsSync(this.filePath)) {
        const raw = fsSync.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object'
          ? { version: parsed.version || 1, records: parsed.records || {} }
          : { version: 1, records: {} };
      }
    } catch (error) {
      logger.warn('Failed to load task records', { error: error.message });
    }
    return { version: 1, records: {} };
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.error('Failed to save task records', { error: error.message });
    }
  }

  list() {
    const records = this.data?.records || {};
    return Object.entries(records).map(([id, rec]) => ({ id, ...(rec || {}) }));
  }

  get(id) {
    if (!id) return null;
    return this.data?.records?.[id] || null;
  }

  normalizePatch(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = {};

    if (p.title !== undefined) next.title = String(p.title || '').trim();
    if (p.tier !== undefined) next.tier = normalizeTier(p.tier);
    if (p.changeRisk !== undefined) next.changeRisk = normalizeRisk(p.changeRisk);
    if (p.baseImpactRisk !== undefined) next.baseImpactRisk = normalizeRisk(p.baseImpactRisk);
    if (p.pFailFirstPass !== undefined) next.pFailFirstPass = clamp01(p.pFailFirstPass);

    if (p.verifyMinutes !== undefined) {
      const n = Number(p.verifyMinutes);
      next.verifyMinutes = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    }

    if (p.promptRef !== undefined) next.promptRef = String(p.promptRef || '').trim();
    if (p.promptVisibility !== undefined) next.promptVisibility = normalizeVisibility(p.promptVisibility);

    if (p.linked) {
      next.linked = p.linked;
    }

    if (p.notes !== undefined) next.notes = String(p.notes || '');

    // Drop nulls for optional fields so we can "clear" by sending null.
    for (const [k, v] of Object.entries(next)) {
      if (v === null) delete next[k];
    }

    return next;
  }

  async upsert(id, patch) {
    if (!id) throw new Error('id is required');
    if (!this.data.records) this.data.records = {};

    const existing = this.data.records[id] || {};
    const normalized = this.normalizePatch(patch);
    const merged = { ...existing, ...normalized, updatedAt: new Date().toISOString() };
    this.data.records[id] = merged;
    await this.save();
    return merged;
  }

  async remove(id) {
    if (!id) throw new Error('id is required');
    if (!this.data.records) this.data.records = {};
    const existed = !!this.data.records[id];
    delete this.data.records[id];
    await this.save();
    return existed;
  }
}

module.exports = { TaskRecordService };

