const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/task-deps.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const parsePrTaskId = (id) => {
  const raw = String(id || '').trim();
  const m = raw.match(/^pr:([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  const [, owner, repo, num] = m;
  return { owner, repo, number: Number(num) };
};

class TaskDependencyService {
  constructor({ taskRecordService, pullRequestService } = {}) {
    this.taskRecordService = taskRecordService;
    this.pullRequestService = pullRequestService;
    this.prCache = new Map(); // key -> { value, expiresAt }
  }

  static getInstance(deps = {}) {
    if (!TaskDependencyService.instance) {
      TaskDependencyService.instance = new TaskDependencyService(deps);
    }
    return TaskDependencyService.instance;
  }

  getDepsForTaskId(taskId) {
    const rec = this.taskRecordService?.get?.(taskId) || {};
    const deps = Array.isArray(rec.dependencies) ? rec.dependencies : [];
    return deps.map(d => String(d).trim()).filter(Boolean);
  }

  isDone(taskId) {
    const rec = this.taskRecordService?.get?.(taskId);
    return !!rec?.doneAt;
  }

  async getPrStateCached({ owner, repo, number }) {
    const key = `${owner}/${repo}#${number}`;
    const now = Date.now();
    const cached = this.prCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await this.pullRequestService.getPullRequest({ owner, repo, number });
    this.prCache.set(key, { value, expiresAt: now + 30_000 });
    return value;
  }

  async resolveDependency(depId) {
    const dep = String(depId || '').trim();
    if (!dep) return null;

    if (this.isDone(dep)) {
      return { id: dep, satisfied: true, reason: 'doneAt' };
    }

    const pr = parsePrTaskId(dep);
    if (pr) {
      try {
        const prInfo = await this.getPrStateCached(pr);
        const merged = String(prInfo?.state || '').toLowerCase() === 'merged';
        return { id: dep, satisfied: merged, reason: merged ? 'pr_merged' : (prInfo?.state ? `pr_${String(prInfo.state).toLowerCase()}` : 'pr_unknown') };
      } catch (error) {
        logger.warn('Failed to resolve PR dependency', { dep, error: error.message });
        return { id: dep, satisfied: false, reason: 'pr_lookup_failed' };
      }
    }

    return { id: dep, satisfied: false, reason: 'manual' };
  }

  async resolveDependencies(taskId) {
    const deps = this.getDepsForTaskId(taskId);
    const resolved = await Promise.all(deps.map(d => this.resolveDependency(d)));
    return resolved.filter(Boolean);
  }

  async getDependencySummary(taskId) {
    const resolved = await this.resolveDependencies(taskId);
    const blocked = resolved.filter(d => !d.satisfied).length;
    return { total: resolved.length, blocked };
  }

  async addDependency(taskId, depId) {
    const current = this.taskRecordService.get(taskId) || {};
    const deps = Array.isArray(current.dependencies) ? current.dependencies.slice() : [];
    const next = [...new Set([...deps, String(depId || '').trim()])].filter(Boolean);
    return this.taskRecordService.upsert(taskId, { dependencies: next });
  }

  async removeDependency(taskId, depId) {
    const current = this.taskRecordService.get(taskId) || {};
    const deps = Array.isArray(current.dependencies) ? current.dependencies : [];
    const target = String(depId || '').trim();
    const next = deps.map(d => String(d).trim()).filter(Boolean).filter(d => d !== target);
    return this.taskRecordService.upsert(taskId, { dependencies: next });
  }

  /**
   * Build a bounded dependency graph for a root task id.
   * Edges are stored as { from: dependent, to: dependency }.
   */
  async buildGraph({ rootId, depth = 2 } = {}) {
    const root = String(rootId || '').trim();
    const maxDepth = Math.max(1, Math.min(6, Number(depth) || 2));
    if (!root) throw new Error('rootId is required');

    const list = typeof this.taskRecordService?.list === 'function'
      ? this.taskRecordService.list()
      : [];

    const recordsById = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || !item.id) continue;
      recordsById.set(String(item.id), item);
    }

    const depsById = new Map();
    const dependentsByDep = new Map(); // depId -> Set(dependentId)

    for (const [id, item] of recordsById.entries()) {
      const rec = item || {};
      const deps = Array.isArray(rec.dependencies) ? rec.dependencies.map(d => String(d || '').trim()).filter(Boolean) : [];
      depsById.set(id, deps);
      for (const dep of deps) {
        if (!dependentsByDep.has(dep)) dependentsByDep.set(dep, new Set());
        dependentsByDep.get(dep).add(id);
      }
    }

    const visited = new Map(); // id -> minDistance
    const queue = [{ id: root, dist: 0 }];
    visited.set(root, 0);

    const nodes = new Map(); // id -> node
    const edges = [];

    const ensureNode = (id) => {
      const tid = String(id || '').trim();
      if (!tid) return null;
      if (nodes.has(tid)) return nodes.get(tid);
      const recItem = recordsById.get(tid);
      const rec = recItem || {};
      const title = String(rec.title || '').trim();
      const tier = Number(rec.tier);
      const node = {
        id: tid,
        label: title || tid,
        kind: tid.startsWith('pr:') ? 'pr' : (tid.startsWith('session:') ? 'session' : (tid.startsWith('worktree:') ? 'worktree' : 'task')),
        tier: (tier >= 1 && tier <= 4) ? tier : null,
        doneAt: rec.doneAt || null,
        reviewedAt: rec.reviewedAt || null
      };
      nodes.set(tid, node);
      return node;
    };

    ensureNode(root);

    while (queue.length) {
      const { id, dist } = queue.shift();
      if (dist >= maxDepth) continue;

      const deps = depsById.get(id) || [];
      for (const dep of deps) {
        ensureNode(dep);
        edges.push({ from: id, to: dep });
        const nextDist = dist + 1;
        const prev = visited.get(dep);
        if (prev === undefined || nextDist < prev) {
          visited.set(dep, nextDist);
          queue.push({ id: dep, dist: nextDist });
        }
      }

      const dependents = Array.from(dependentsByDep.get(id) || []);
      for (const depId of dependents) {
        ensureNode(depId);
        const nextDist = dist + 1;
        const prev = visited.get(depId);
        if (prev === undefined || nextDist < prev) {
          visited.set(depId, nextDist);
          queue.push({ id: depId, dist: nextDist });
        }
      }
    }

    // Resolve edge satisfaction (best-effort) based on the dependency node id.
    const uniqueDeps = new Set(edges.map(e => e.to));
    const resolvedById = new Map();
    for (const depId of uniqueDeps) {
      try {
        const resolved = await this.resolveDependency(depId);
        if (resolved) resolvedById.set(depId, resolved);
      } catch {
        // ignore
      }
    }

    const edgesResolved = edges.map((e) => {
      const resolved = resolvedById.get(e.to);
      return {
        from: e.from,
        to: e.to,
        satisfied: resolved ? !!resolved.satisfied : false,
        reason: resolved ? resolved.reason : 'unknown'
      };
    });

    return {
      rootId: root,
      depth: maxDepth,
      nodes: Array.from(nodes.values()),
      edges: edgesResolved
    };
  }
}

module.exports = { TaskDependencyService, parsePrTaskId };
