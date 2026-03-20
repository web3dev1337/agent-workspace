const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');

const {
  safeId,
  resolveSafeRelativePath,
  encryptText,
  decryptText
} = require('./promptArtifactService');

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

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const DEFAULT_PATH = path.join(getAgentWorkspaceDir(), 'task-records.json');

const RECORD_POINTER_KEYS = new Set(['recordVisibility', 'recordRepoRoot', 'recordPath']);

const getTaskRecordPassphrase = () => {
  return String(
    process.env.ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY
    || process.env.ORCHESTRATOR_TASK_RECORDS_PASSPHRASE
    || process.env.ORCHESTRATOR_PROMPT_ENCRYPTION_KEY
    || process.env.ORCHESTRATOR_PROMPT_PASSPHRASE
    || ''
  );
};

const stripRecordPointers = (rec) => {
  const r = rec && typeof rec === 'object' ? rec : {};
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (RECORD_POINTER_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
};

const getDefaultRepoTaskRecordPaths = (id) => {
  const sid = safeId(id);
  return {
    shared: path.join('.agent-workspace', 'task-records', `${sid}.json`),
    encrypted: path.join('.agent-workspace', 'task-records', `${sid}.enc.json`)
  };
};

const readTaskRecordFromRepoSync = ({ id, repoRoot, relPath, visibility = 'shared', passphrase } = {}) => {
  const full = resolveSafeRelativePath(repoRoot, relPath);
  if (!fsSync.existsSync(full)) return null;

  if (visibility === 'encrypted') {
    const raw = fsSync.readFileSync(full, 'utf8');
    const parsed = JSON.parse(raw);
    const jsonText = decryptText({ payload: parsed, passphrase });
    const unpacked = JSON.parse(jsonText);
    const record = (unpacked && typeof unpacked === 'object' && unpacked.record && typeof unpacked.record === 'object')
      ? unpacked.record
      : (unpacked && typeof unpacked === 'object' ? unpacked : null);
    if (!record) return null;
    return record;
  }

  const raw = fsSync.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  const record = (parsed && typeof parsed === 'object' && parsed.record && typeof parsed.record === 'object')
    ? parsed.record
    : (parsed && typeof parsed === 'object' ? parsed : null);
  if (!record) return null;
  return record;
};

const writeTaskRecordToRepo = async ({ id, repoRoot, relPath, visibility = 'shared', record, passphrase } = {}) => {
  const full = resolveSafeRelativePath(repoRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });

  const body = {
    v: 1,
    id: safeId(id),
    record: stripRecordPointers(record)
  };

  if (visibility === 'encrypted') {
    const payload = encryptText({ text: JSON.stringify(body), passphrase });
    await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  }

  await fs.writeFile(full, JSON.stringify(body, null, 2), 'utf8');
  return true;
};

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

const normalizeTicketProvider = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const allowed = new Set(['trello']);
  return allowed.has(s) ? s : null;
};

const normalizeClaimedBy = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return s.slice(0, 120);
};

const normalizeAssignedTo = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  return s.slice(0, 120);
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

const normalizeReviewChecklist = (raw) => {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return null;

  const out = {};

  const tests = raw.tests && typeof raw.tests === 'object' ? raw.tests : {};
  const manual = raw.manual && typeof raw.manual === 'object' ? raw.manual : {};

  const testsDone = tests.done === undefined ? null : !!tests.done;
  const testsCommand = tests.command === undefined ? null : String(tests.command || '').trim().slice(0, 300);
  if (testsDone === true || (testsCommand !== null && testsCommand !== '')) {
    out.tests = {};
    if (testsDone === true) out.tests.done = true;
    if (testsCommand !== null && testsCommand !== '') out.tests.command = testsCommand;
  }

  const manualDone = manual.done === undefined ? null : !!manual.done;
  const manualSteps = manual.steps === undefined ? null : String(manual.steps || '').trim().slice(0, 2000);
  if (manualDone === true || (manualSteps !== null && manualSteps !== '')) {
    out.manual = {};
    if (manualDone === true) out.manual.done = true;
    if (manualSteps !== null && manualSteps !== '') out.manual.steps = manualSteps;
  }

  return Object.keys(out).length ? out : null;
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
    return Object.entries(records).map(([id]) => ({ id, ...(this.get(id) || {}) }));
  }

  get(id) {
    if (!id) return null;

    const local = this.data?.records?.[id] || null;
    const visibility = String(local?.recordVisibility || '').trim().toLowerCase();
    if (visibility !== 'shared' && visibility !== 'encrypted') return local;

    const repoRoot = String(local?.recordRepoRoot || '').trim();
    const relPath = String(local?.recordPath || '').trim() || getDefaultRepoTaskRecordPaths(id)[visibility];
    if (!repoRoot || !relPath) return local;

    try {
      const passphrase = visibility === 'encrypted' ? getTaskRecordPassphrase() : '';
      if (visibility === 'encrypted' && !passphrase) return local;
      const fromRepo = readTaskRecordFromRepoSync({ id, repoRoot, relPath, visibility, passphrase });
      if (!fromRepo) return local;
      return {
        ...stripRecordPointers(fromRepo),
        recordVisibility: visibility,
        recordRepoRoot: repoRoot,
        recordPath: relPath
      };
    } catch (error) {
      logger.warn('Failed to resolve task record from repo', { id, error: error.message });
      return local;
    }
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
    if (p.promptRepoRoot !== undefined) {
      if (p.promptRepoRoot === null || p.promptRepoRoot === '') clear.add('promptRepoRoot');
      else next.promptRepoRoot = String(p.promptRepoRoot || '').trim().slice(0, 600);
    }
    if (p.promptPath !== undefined) {
      if (p.promptPath === null || p.promptPath === '') clear.add('promptPath');
      else next.promptPath = String(p.promptPath || '').trim().slice(0, 600);
    }

    if (p.dependencies !== undefined) {
      if (p.dependencies === null) {
        clear.add('dependencies');
      } else {
        const normalized = normalizeDependencies(p.dependencies);
        if (normalized !== null) next.dependencies = normalized;
      }
    }

    if (p.reviewChecklist !== undefined) {
      if (p.reviewChecklist === null) {
        clear.add('reviewChecklist');
      } else {
        const normalized = normalizeReviewChecklist(p.reviewChecklist);
        if (normalized !== null) next.reviewChecklist = normalized;
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

    if (p.recheckSpawnedAt !== undefined) {
      const dt = normalizeDateTime(p.recheckSpawnedAt);
      if (dt) next.recheckSpawnedAt = dt;
      else clear.add('recheckSpawnedAt');
    }

    if (p.recheckWorktreeId !== undefined) {
      if (p.recheckWorktreeId === null || p.recheckWorktreeId === '') {
        clear.add('recheckWorktreeId');
      } else {
        next.recheckWorktreeId = String(p.recheckWorktreeId || '').trim();
      }
    }

    if (p.overnightSpawnedAt !== undefined) {
      const dt = normalizeDateTime(p.overnightSpawnedAt);
      if (dt) next.overnightSpawnedAt = dt;
      else clear.add('overnightSpawnedAt');
    }

    if (p.overnightWorktreeId !== undefined) {
      if (p.overnightWorktreeId === null || p.overnightWorktreeId === '') {
        clear.add('overnightWorktreeId');
      } else {
        next.overnightWorktreeId = String(p.overnightWorktreeId || '').trim();
      }
    }

    // Optional external ticket/task link (v1: Trello)
    if (p.ticketProvider !== undefined) {
      if (p.ticketProvider === null || p.ticketProvider === '') {
        clear.add('ticketProvider');
      } else {
        const provider = normalizeTicketProvider(p.ticketProvider);
        if (provider !== null) next.ticketProvider = provider;
      }
    }
    if (p.ticketCardId !== undefined) {
      if (p.ticketCardId === null || p.ticketCardId === '') {
        clear.add('ticketCardId');
      } else {
        next.ticketCardId = String(p.ticketCardId || '').trim().slice(0, 120);
      }
    }
    if (p.ticketBoardId !== undefined) {
      if (p.ticketBoardId === null || p.ticketBoardId === '') {
        clear.add('ticketBoardId');
      } else {
        next.ticketBoardId = String(p.ticketBoardId || '').trim().slice(0, 120);
      }
    }
    if (p.ticketCardUrl !== undefined) {
      if (p.ticketCardUrl === null || p.ticketCardUrl === '') {
        clear.add('ticketCardUrl');
      } else {
        next.ticketCardUrl = String(p.ticketCardUrl || '').trim().slice(0, 600);
      }
    }
    if (p.ticketTitle !== undefined) {
      if (p.ticketTitle === null || p.ticketTitle === '') {
        clear.add('ticketTitle');
      } else {
        next.ticketTitle = String(p.ticketTitle || '').trim().slice(0, 240);
      }
    }

    // Automation bookkeeping (best-effort; used to avoid repeating automations)
    if (p.prMergedAt !== undefined) {
      const dt = normalizeDateTime(p.prMergedAt);
      if (dt) next.prMergedAt = dt;
      else clear.add('prMergedAt');
    }
    if (p.ticketMovedAt !== undefined) {
      const dt = normalizeDateTime(p.ticketMovedAt);
      if (dt) next.ticketMovedAt = dt;
      else clear.add('ticketMovedAt');
    }
    if (p.ticketMoveTargetListId !== undefined) {
      if (p.ticketMoveTargetListId === null || p.ticketMoveTargetListId === '') {
        clear.add('ticketMoveTargetListId');
      } else {
        next.ticketMoveTargetListId = String(p.ticketMoveTargetListId || '').trim().slice(0, 120);
      }
    }
    if (p.ticketClosedAt !== undefined) {
      const dt = normalizeDateTime(p.ticketClosedAt);
      if (dt) next.ticketClosedAt = dt;
      else clear.add('ticketClosedAt');
    }

    // Simple queue locking / claiming (review conveyor v2)
    if (p.claimed !== undefined) {
      const claimed = !!p.claimed;
      if (claimed) {
        if (!next.claimedAt) next.claimedAt = new Date().toISOString();
      } else {
        clear.add('claimedAt');
        clear.add('claimedBy');
      }
    }
    if (p.claimedBy !== undefined) {
      if (p.claimedBy === null || p.claimedBy === '') {
        clear.add('claimedBy');
      } else {
        const who = normalizeClaimedBy(p.claimedBy);
        if (who !== null) next.claimedBy = who;
      }
    }
    if (p.claimedAt !== undefined) {
      const dt = normalizeDateTime(p.claimedAt);
      if (dt) next.claimedAt = dt;
      else clear.add('claimedAt');
    }

    // Sling assignment (v1): assign a task record to an identity.
    if (p.assignedTo !== undefined) {
      if (p.assignedTo === null || p.assignedTo === '') {
        clear.add('assignedTo');
        clear.add('assignedAt');
      } else {
        const who = normalizeAssignedTo(p.assignedTo);
        if (who !== null) {
          next.assignedTo = who;
          if (!next.assignedAt) next.assignedAt = new Date().toISOString();
        }
      }
    }
    if (p.assignedAt !== undefined) {
      const dt = normalizeDateTime(p.assignedAt);
      if (dt) next.assignedAt = dt;
      else clear.add('assignedAt');
    }

    if (p.linked) {
      next.linked = p.linked;
    }

    if (p.notes !== undefined) {
      if (p.notes === null) clear.add('notes');
      else next.notes = String(p.notes || '');
    }

    // Task record store pointers (v1)
    if (p.recordVisibility !== undefined) {
      if (p.recordVisibility === null || p.recordVisibility === '') {
        clear.add('recordVisibility');
      } else {
        const v = normalizeVisibility(p.recordVisibility);
        if (v !== null) next.recordVisibility = v;
      }
    }
    if (p.recordRepoRoot !== undefined) {
      if (p.recordRepoRoot === null || p.recordRepoRoot === '') clear.add('recordRepoRoot');
      else next.recordRepoRoot = String(p.recordRepoRoot || '').trim().slice(0, 600);
    }
    if (p.recordPath !== undefined) {
      if (p.recordPath === null || p.recordPath === '') clear.add('recordPath');
      else next.recordPath = String(p.recordPath || '').trim().slice(0, 600);
    }

    return { next, clear: Array.from(clear) };
  }

  async upsert(id, patch) {
    if (!id) throw new Error('id is required');
    if (!this.data.records) this.data.records = {};

    const nowIso = new Date().toISOString();

    const existed = !!this.data.records[id];
    const existingLocal = this.data.records[id] || {};
    const { next, clear } = this.normalizePatch(patch);

    const pointerVisibility = String(next.recordVisibility || existingLocal.recordVisibility || 'private').trim().toLowerCase();
    const toSharedOrEncrypted = pointerVisibility === 'shared' || pointerVisibility === 'encrypted';

    // If switching from repo-backed -> private, import the latest repo record first (best-effort).
    if (!toSharedOrEncrypted && (existingLocal.recordVisibility === 'shared' || existingLocal.recordVisibility === 'encrypted')) {
      const oldVisibility = String(existingLocal.recordVisibility).trim().toLowerCase();
      const repoRoot = String(existingLocal.recordRepoRoot || '').trim();
      const relPath = String(existingLocal.recordPath || '').trim() || getDefaultRepoTaskRecordPaths(id)[oldVisibility];
      if (repoRoot && relPath) {
        try {
          const passphrase = oldVisibility === 'encrypted' ? getTaskRecordPassphrase() : '';
          if (oldVisibility !== 'encrypted' || passphrase) {
            const fromRepo = readTaskRecordFromRepoSync({ id, repoRoot, relPath, visibility: oldVisibility, passphrase });
            if (fromRepo) {
              this.data.records[id] = {
                ...stripRecordPointers(fromRepo),
                createdAt: fromRepo.createdAt || existingLocal.createdAt || nowIso,
                updatedAt: fromRepo.updatedAt || nowIso
              };
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const baseLocal = this.data.records[id] || {};
    const nextNonPointers = {};
    for (const [k, v] of Object.entries(next)) {
      if (RECORD_POINTER_KEYS.has(k)) continue;
      nextNonPointers[k] = v;
    }
    const clearNonPointers = clear.filter((k) => !RECORD_POINTER_KEYS.has(k));

    const mergedCandidate = { ...baseLocal, ...nextNonPointers, updatedAt: nowIso };
    if (!existed && !mergedCandidate.createdAt) mergedCandidate.createdAt = nowIso;
    for (const k of clearNonPointers) delete mergedCandidate[k];

    if (!toSharedOrEncrypted) {
      // private store (local JSON)
      const merged = { ...mergedCandidate };
      for (const k of Array.from(RECORD_POINTER_KEYS)) delete merged[k];
      this.data.records[id] = merged;
      await this.save();
      return merged;
    }

    const repoRoot = String(next.recordRepoRoot || existingLocal.recordRepoRoot || '').trim();
    if (!repoRoot) throw new Error('recordRepoRoot is required for shared/encrypted records');
    const relPath = String(next.recordPath || existingLocal.recordPath || '').trim() || getDefaultRepoTaskRecordPaths(id)[pointerVisibility];
    if (!relPath) throw new Error('recordPath is required for shared/encrypted records');

    if (pointerVisibility === 'encrypted') {
      const passphrase = getTaskRecordPassphrase();
      if (!passphrase) {
        throw new Error('Encrypted task records require ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY (or ORCHESTRATOR_TASK_RECORDS_PASSPHRASE) to be set');
      }
    }

    // Write to repo, then cache the merged record locally with pointers.
    const passphrase = pointerVisibility === 'encrypted' ? getTaskRecordPassphrase() : '';
    const existingRepo = (() => {
      try {
        return readTaskRecordFromRepoSync({ id, repoRoot, relPath, visibility: pointerVisibility, passphrase }) || null;
      } catch {
        return null;
      }
    })();
    const baseRepo = existingRepo ? stripRecordPointers(existingRepo) : stripRecordPointers(existingLocal);
    const createdAt = baseRepo.createdAt || existingLocal.createdAt || nowIso;
    const mergedRepo = { ...baseRepo, ...nextNonPointers, createdAt, updatedAt: nowIso };
    for (const k of clearNonPointers) delete mergedRepo[k];

    await writeTaskRecordToRepo({
      id,
      repoRoot,
      relPath,
      visibility: pointerVisibility,
      record: mergedRepo,
      passphrase
    });

    const cached = {
      ...stripRecordPointers(mergedRepo),
      recordVisibility: pointerVisibility,
      recordRepoRoot: repoRoot,
      recordPath: relPath
    };
    this.data.records[id] = cached;
    await this.save();
    return cached;
  }

  async remove(id) {
    if (!id) throw new Error('id is required');
    if (!this.data.records) this.data.records = {};
    const existed = !!this.data.records[id];
    delete this.data.records[id];
    await this.save();
    return existed;
  }

  defaultRepoTaskRecordPaths(id) {
    return getDefaultRepoTaskRecordPaths(id);
  }

  async promoteToRepo({ id, repoRoot, relPath, visibility = 'shared' } = {}) {
    const taskId = String(id || '').trim();
    if (!taskId) throw new Error('id is required');
    const store = String(visibility || '').trim().toLowerCase();
    if (store !== 'shared' && store !== 'encrypted') throw new Error('visibility must be shared|encrypted');

    const root = String(repoRoot || '').trim();
    if (!root) throw new Error('repoRoot is required');
    const defaults = this.defaultRepoTaskRecordPaths(taskId);
    const rp = String(relPath || defaults[store] || '').trim();
    if (!rp) throw new Error('relPath is required');

    const passphrase = store === 'encrypted' ? getTaskRecordPassphrase() : '';
    if (store === 'encrypted' && !passphrase) {
      throw new Error('Encrypted task records require ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY (or ORCHESTRATOR_TASK_RECORDS_PASSPHRASE) to be set');
    }

    const existing = this.data?.records?.[taskId] || null;
    if (!existing) return null;
    const record = stripRecordPointers(existing);

    await writeTaskRecordToRepo({ id: taskId, repoRoot: root, relPath: rp, visibility: store, record, passphrase });

    const cached = {
      ...stripRecordPointers(record),
      recordVisibility: store,
      recordRepoRoot: root,
      recordPath: rp,
      updatedAt: new Date().toISOString()
    };
    if (!cached.createdAt) cached.createdAt = existing?.createdAt || cached.updatedAt;
    this.data.records[taskId] = cached;
    await this.save();
    return cached;
  }
}

module.exports = { TaskRecordService };
