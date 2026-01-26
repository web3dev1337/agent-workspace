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

const normalizeReviewOutcome = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const allowed = new Set(['approved', 'needs_fix', 'commented', 'skipped']);
  return allowed.has(s) ? s : null;
};

const normalizeDateTime = (v) => {
  if (v === null || v === '') return null;
  const dt = new Date(v);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
};

const normalizeDependencies = (deps) => {
  if (deps === null) return [];
  if (!Array.isArray(deps)) return null;
  const cleaned = deps
    .map(d => String(d || '').trim())
    .filter(Boolean)
    .slice(0, 200);
  return [...new Set(cleaned)];
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
    const clear = new Set();

    if (p.title !== undefined) {
      if (p.title === null) clear.add('title');
      else next.title = String(p.title || '').trim();
    }
    if (p.tier !== undefined) {
      if (p.tier === null) clear.add('tier');
      else {
        const t = normalizeTier(p.tier);
        if (t !== null) next.tier = t;
      }
    }
    if (p.changeRisk !== undefined) {
      if (p.changeRisk === null) clear.add('changeRisk');
      else {
        const r = normalizeRisk(p.changeRisk);
        if (r !== null) next.changeRisk = r;
      }
    }
    if (p.baseImpactRisk !== undefined) {
      if (p.baseImpactRisk === null) clear.add('baseImpactRisk');
      else {
        const r = normalizeRisk(p.baseImpactRisk);
        if (r !== null) next.baseImpactRisk = r;
      }
    }
    if (p.pFailFirstPass !== undefined) {
      if (p.pFailFirstPass === null) clear.add('pFailFirstPass');
      else {
        const v = clamp01(p.pFailFirstPass);
        if (v !== null) next.pFailFirstPass = v;
      }
    }

    if (p.verifyMinutes !== undefined) {
      if (p.verifyMinutes === null) {
        clear.add('verifyMinutes');
      } else {
        const n = Number(p.verifyMinutes);
        if (Number.isFinite(n) && n >= 0) next.verifyMinutes = Math.round(n);
      }
    }

    if (p.promptRef !== undefined) {
      if (p.promptRef === null) clear.add('promptRef');
      else next.promptRef = String(p.promptRef || '').trim();
    }
    if (p.promptVisibility !== undefined) {
      if (p.promptVisibility === null) clear.add('promptVisibility');
      else {
        const v = normalizeVisibility(p.promptVisibility);
        if (v !== null) next.promptVisibility = v;
      }
    }

    if (p.dependencies !== undefined) {
      if (p.dependencies === null) {
        clear.add('dependencies');
      } else {
        const normalized = normalizeDependencies(p.dependencies);
        if (normalized !== null) next.dependencies = normalized;
      }
    }

    if (p.done !== undefined) {
      const done = !!p.done;
      if (done) next.doneAt = new Date().toISOString();
      else clear.add('doneAt');
    }

    if (p.doneAt !== undefined) {
      const v = p.doneAt;
      if (v === null || v === '') {
        clear.add('doneAt');
      } else {
        const dt = new Date(v);
        if (Number.isFinite(dt.getTime())) next.doneAt = dt.toISOString();
      }
    }

    if (p.reviewed !== undefined) {
      const reviewed = !!p.reviewed;
      if (reviewed) next.reviewedAt = new Date().toISOString();
      else clear.add('reviewedAt');
    }

    if (p.reviewedAt !== undefined) {
      const v = p.reviewedAt;
      if (v === null || v === '') {
        clear.add('reviewedAt');
      } else {
        const dt = new Date(v);
        if (Number.isFinite(dt.getTime())) next.reviewedAt = dt.toISOString();
      }
    }

    if (p.reviewOutcome !== undefined) {
      if (p.reviewOutcome === null || p.reviewOutcome === '') {
        clear.add('reviewOutcome');
      } else {
        const outcome = normalizeReviewOutcome(p.reviewOutcome);
        if (outcome !== null) {
          next.reviewOutcome = outcome;
          if (!next.reviewedAt) next.reviewedAt = new Date().toISOString();
        }
      }
    }

    if (p.reviewStartedAt !== undefined) {
      const dt = normalizeDateTime(p.reviewStartedAt);
      if (dt) next.reviewStartedAt = dt;
      else clear.add('reviewStartedAt');
    }

    if (p.reviewEndedAt !== undefined) {
      const dt = normalizeDateTime(p.reviewEndedAt);
      if (dt) next.reviewEndedAt = dt;
      else clear.add('reviewEndedAt');
    }

    if (p.promptSentAt !== undefined) {
      const dt = normalizeDateTime(p.promptSentAt);
      if (dt) next.promptSentAt = dt;
      else clear.add('promptSentAt');
    }

    if (p.promptChars !== undefined) {
      if (p.promptChars === null) {
        clear.add('promptChars');
      } else {
        const n = Number(p.promptChars);
        if (Number.isFinite(n) && n >= 0) next.promptChars = Math.round(n);
      }
    }

    if (p.reviewerSpawnedAt !== undefined) {
      const dt = normalizeDateTime(p.reviewerSpawnedAt);
      if (dt) next.reviewerSpawnedAt = dt;
      else clear.add('reviewerSpawnedAt');
    }

    if (p.reviewerWorktreeId !== undefined) {
      if (p.reviewerWorktreeId === null || p.reviewerWorktreeId === '') {
        clear.add('reviewerWorktreeId');
      } else {
        next.reviewerWorktreeId = String(p.reviewerWorktreeId || '').trim();
      }
    }

    if (p.fixerSpawnedAt !== undefined) {
      const dt = normalizeDateTime(p.fixerSpawnedAt);
      if (dt) next.fixerSpawnedAt = dt;
      else clear.add('fixerSpawnedAt');
    }

    if (p.fixerWorktreeId !== undefined) {
      if (p.fixerWorktreeId === null || p.fixerWorktreeId === '') {
        clear.add('fixerWorktreeId');
      } else {
        next.fixerWorktreeId = String(p.fixerWorktreeId || '').trim();
      }
    }

    if (p.linked) {
      next.linked = p.linked;
    }

    if (p.notes !== undefined) {
      if (p.notes === null) clear.add('notes');
      else next.notes = String(p.notes || '');
    }

    return { next, clear: Array.from(clear) };
  }

  async upsert(id, patch) {
    if (!id) throw new Error('id is required');
    if (!this.data.records) this.data.records = {};

    const existing = this.data.records[id] || {};
    const { next, clear } = this.normalizePatch(patch);
    const merged = { ...existing, ...next, updatedAt: new Date().toISOString() };
    for (const k of clear) {
      delete merged[k];
    }
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
