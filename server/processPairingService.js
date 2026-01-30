const path = require('path');
const winston = require('winston');

const { TTLCache } = require('./utils/ttlCache');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const normalizeTier = (value) => {
  const tier = Number(value);
  return tier >= 1 && tier <= 4 ? tier : null;
};

const deriveProjectFromRepository = (repoSlug) => {
  const raw = String(repoSlug || '').trim();
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
};

const deriveProjectRootFromWorktreePath = (worktreePath) => {
  const resolved = path.resolve(String(worktreePath || ''));
  const base = path.basename(resolved);

  if (/^work\d+$/i.test(base)) return path.dirname(resolved);
  if (String(base).toLowerCase() === 'master') return path.dirname(resolved);

  const siblingMatch = base.match(/^(.*)-work(\d+)$/i);
  if (siblingMatch?.[1]) return path.join(path.dirname(resolved), siblingMatch[1]);

  return resolved;
};

const safeIdLabel = (task) => {
  const id = String(task?.id || '').trim();
  if (!id) return '(unknown)';
  if (id.startsWith('pr:')) return id;
  if (id.startsWith('worktree:')) return id.replace(/^worktree:/, 'worktree:');
  if (id.startsWith('session:')) return id;
  return id;
};

class ProcessPairingService {
  constructor({ processTaskService, taskRecordService, worktreeConflictService, projectMetadataService } = {}) {
    this.processTaskService = processTaskService;
    this.taskRecordService = taskRecordService;
    this.worktreeConflictService = worktreeConflictService;
    this.projectMetadataService = projectMetadataService;
    this.cache = new TTLCache({ defaultTtlMs: 25_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessPairingService.instance) {
      ProcessPairingService.instance = new ProcessPairingService(deps);
    }
    return ProcessPairingService.instance;
  }

  async listCandidates({ mode = 'mine', tiers = [2, 3], limit = 40, refresh = false } = {}) {
    const tierSet = new Set((Array.isArray(tiers) ? tiers : [tiers]).map(normalizeTier).filter(Boolean));
    const max = Math.max(1, Math.min(100, Number(limit) || 40));

    let tasks = [];
    try {
      tasks = await this.processTaskService.listTasks({
        prs: { mode, state: 'open', sort: 'updated', limit: 50 }
      });
    } catch (error) {
      logger.warn('Failed to list process tasks for pairing; continuing with empty list', { error: error.message });
      tasks = [];
    }

    const enriched = [];
    for (const t of tasks) {
      const record = this.taskRecordService?.get?.(t?.id) || null;
      const tier = normalizeTier(record?.tier);
      if (!tier || !tierSet.has(tier)) continue;
      if (record?.doneAt) continue;

      enriched.push({ ...t, record, tier });
      if (enriched.length >= max) break;
    }

    const byPath = new Map();
    for (const t of enriched) {
      const p = String(t?.worktreePath || '').trim();
      if (!p) continue;
      byPath.set(p, t);
    }

    const projectByPath = {};
    if (this.projectMetadataService && byPath.size) {
      await Promise.all(Array.from(byPath.keys()).map(async (p) => {
        try {
          const meta = await this.projectMetadataService.getForWorktree(p, { refresh });
          projectByPath[p] = meta?.projectKey || meta?.projectRoot || '';
        } catch {
          projectByPath[p] = '';
        }
      }));
    }

    const filesByPath = {};
    if (this.worktreeConflictService && byPath.size) {
      await Promise.all(Array.from(byPath.keys()).map(async (p) => {
        try {
          const files = await this.worktreeConflictService.getChangedFiles(p);
          filesByPath[p] = Array.isArray(files) ? files : [];
        } catch {
          filesByPath[p] = [];
        }
      }));
    }

    return enriched.map((t) => {
      const worktreePath = String(t?.worktreePath || '').trim();
      const repository = String(t?.repository || '').trim();
      const projectKey = worktreePath
        ? (String(projectByPath[worktreePath] || '').trim() || deriveProjectRootFromWorktreePath(worktreePath))
        : deriveProjectFromRepository(repository);

      const changedFiles = worktreePath ? (filesByPath[worktreePath] || []) : [];
      return {
        id: String(t.id || '').trim(),
        kind: t.kind,
        title: t.title || '',
        url: t.url || '',
        repository: repository || null,
        worktreePath: worktreePath || null,
        tier: t.tier,
        projectKey: projectKey || '',
        changedFiles
      };
    });
  }

  computePairing(a, b) {
    const reasons = [];
    const aKey = String(a?.projectKey || '').trim();
    const bKey = String(b?.projectKey || '').trim();
    const sameProject = aKey && bKey && aKey === bKey;

    const aFiles = new Set(Array.isArray(a?.changedFiles) ? a.changedFiles : []);
    const bFiles = new Set(Array.isArray(b?.changedFiles) ? b.changedFiles : []);
    const overlap = [];
    for (const f of aFiles) {
      if (bFiles.has(f)) overlap.push(f);
    }

    let conflict = 0;
    if (!sameProject) {
      reasons.push('different_project');
      conflict = 0;
    } else {
      reasons.push('same_project');
      conflict = 0.2;
      const bothPr = a.kind === 'pr' && b.kind === 'pr';
      const bothDirty = aFiles.size > 0 && bFiles.size > 0;
      if (bothPr) {
        reasons.push('parallel_prs');
        conflict = Math.max(conflict, 0.6);
      }
      if (bothDirty) {
        reasons.push('parallel_uncommitted');
        conflict = Math.max(conflict, 0.4);
      }
      if (overlap.length > 0) {
        reasons.push('file_overlap');
        conflict = 1.0;
      }
    }

    const distance = sameProject ? 0 : 2;
    const score = 1 - Math.min(1, (0.7 * conflict) + (0.3 * (distance / 2)));

    return {
      a,
      b,
      score: Number(score.toFixed(3)),
      conflict: Number(conflict.toFixed(3)),
      distance,
      reasons,
      overlapFiles: overlap.slice(0, 50)
    };
  }

  async getPairings({ mode = 'mine', tiers = [2, 3], limit = 10, refresh = false } = {}) {
    const tierKey = (Array.isArray(tiers) ? tiers : [tiers]).map(normalizeTier).filter(Boolean).sort((x, y) => x - y).join(',');
    const maxPairs = Math.max(1, Math.min(50, Number(limit) || 10));
    const cacheKey = `pairing:${mode}:${tierKey}:${maxPairs}`;

    return this.cache.getOrCompute(cacheKey, async () => {
      const candidates = await this.listCandidates({ mode, tiers, limit: 40, refresh });
      const pairs = [];
      for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
          pairs.push(this.computePairing(candidates[i], candidates[j]));
        }
      }

      pairs.sort((x, y) => {
        if (y.score !== x.score) return y.score - x.score;
        if (x.conflict !== y.conflict) return x.conflict - y.conflict;
        return safeIdLabel(x.a).localeCompare(safeIdLabel(y.a));
      });

      const best = pairs.slice(0, maxPairs).map((p) => ({
        score: p.score,
        conflict: p.conflict,
        distance: p.distance,
        reasons: p.reasons,
        overlapFiles: p.overlapFiles,
        a: {
          id: p.a.id,
          kind: p.a.kind,
          tier: p.a.tier,
          title: p.a.title,
          repository: p.a.repository,
          worktreePath: p.a.worktreePath
        },
        b: {
          id: p.b.id,
          kind: p.b.kind,
          tier: p.b.tier,
          title: p.b.title,
          repository: p.b.repository,
          worktreePath: p.b.worktreePath
        }
      }));

      return {
        mode,
        tiers: tierKey ? tierKey.split(',').map(Number).filter(Boolean) : [],
        generatedAt: new Date().toISOString(),
        count: best.length,
        pairs: best
      };
    }, { force: !!refresh });
  }
}

module.exports = { ProcessPairingService };

