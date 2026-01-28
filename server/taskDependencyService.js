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

const parseTrelloTaskId = (id) => {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const tag = raw.match(/^trello:([a-zA-Z0-9]+)$/i);
  if (tag?.[1]) return { shortLink: tag[1] };
  const url = raw.match(/trello\.com\/c\/([a-zA-Z0-9]+)(?:\/|\b)/i);
  if (url?.[1]) return { shortLink: url[1] };
  return null;
};

const detectCycles = ({ nodeIds, edges, limit = 5 } = {}) => {
  const ids = Array.isArray(nodeIds) ? nodeIds.map(String) : [];
  const edgeList = Array.isArray(edges) ? edges : [];
  const max = Math.max(0, Math.min(25, Number(limit) || 5));
  if (!ids.length || !edgeList.length || max === 0) return [];

  const idSet = new Set(ids);
  const adj = new Map();
  for (const e of edgeList) {
    const from = String(e?.from || '').trim();
    const to = String(e?.to || '').trim();
    if (!from || !to) continue;
    if (!idSet.has(from) || !idSet.has(to)) continue;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }

  const visited = new Set();
  const inStack = new Set();
  const stack = [];
  const cycles = [];
  const seen = new Set();

  const recordCycle = (toId) => {
    const idx = stack.lastIndexOf(toId);
    if (idx < 0) return;
    const cycle = stack.slice(idx).concat([toId]);
    const key = cycle.join('>');
    if (seen.has(key)) return;
    seen.add(key);
    cycles.push(cycle);
  };

  const dfs = (id) => {
    if (cycles.length >= max) return;
    visited.add(id);
    inStack.add(id);
    stack.push(id);

    const next = adj.get(id) || [];
    for (const to of next) {
      if (cycles.length >= max) break;
      if (!visited.has(to)) {
        dfs(to);
      } else if (inStack.has(to)) {
        recordCycle(to);
      }
    }

    stack.pop();
    inStack.delete(id);
  };

  for (const id of ids) {
    if (cycles.length >= max) break;
    if (!visited.has(id)) dfs(id);
  }

  return cycles;
};

class TaskDependencyService {
  constructor({ taskRecordService, pullRequestService, taskTicketingService } = {}) {
    this.taskRecordService = taskRecordService;
    this.pullRequestService = pullRequestService;
    this.taskTicketingService = taskTicketingService;
    this.prCache = new Map(); // key -> { value, expiresAt }
    this.trelloCardCache = new Map(); // shortLink -> { value, expiresAt }
    this.trelloDepsCache = new Map(); // shortLink -> { value, expiresAt }
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

  getTrelloProviderSafe() {
    try {
      if (!this.taskTicketingService) return null;
      return this.taskTicketingService.getProvider('trello');
    } catch {
      return null;
    }
  }

  async getTrelloCardCached(shortLink) {
    const key = String(shortLink || '').trim();
    if (!key) return null;
    const now = Date.now();
    const cached = this.trelloCardCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const provider = this.getTrelloProviderSafe();
    if (!provider) return null;
    const value = await provider.getCard({ cardId: key, refresh: false });
    this.trelloCardCache.set(key, { value, expiresAt: now + 30_000 });
    return value;
  }

  async getTrelloDepsCached(shortLink) {
    const key = String(shortLink || '').trim();
    if (!key) return [];
    const now = Date.now();
    const cached = this.trelloDepsCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const provider = this.getTrelloProviderSafe();
    if (!provider) return [];
    const deps = await provider.getDependencies({ cardId: key, refresh: false });
    const items = Array.isArray(deps?.items) ? deps.items : [];
    this.trelloDepsCache.set(key, { value: items, expiresAt: now + 30_000 });
    return items;
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

    const trello = parseTrelloTaskId(dep);
    if (trello) {
      try {
        const card = await this.getTrelloCardCached(trello.shortLink);
        if (!card) return { id: dep, satisfied: false, reason: 'trello_not_configured' };
        const closed = !!card?.closed;
        return { id: dep, satisfied: closed, reason: closed ? 'trello_closed' : 'trello_open' };
      } catch (error) {
        logger.warn('Failed to resolve Trello dependency', { dep, error: error.message });
        return { id: dep, satisfied: false, reason: 'trello_lookup_failed' };
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
        kind: tid.startsWith('pr:') ? 'pr'
          : (tid.startsWith('session:') ? 'session'
            : (tid.startsWith('worktree:') ? 'worktree'
              : (tid.startsWith('trello:') ? 'trello' : 'task'))),
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
        edges.push({ from: id, to: dep, source: 'record' });
        const nextDist = dist + 1;
        const prev = visited.get(dep);
        if (prev === undefined || nextDist < prev) {
          visited.set(dep, nextDist);
          queue.push({ id: dep, dist: nextDist });
        }
      }

      const trello = parseTrelloTaskId(id);
      if (trello) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const items = await this.getTrelloDepsCached(trello.shortLink);
          for (const item of Array.isArray(items) ? items : []) {
            const short = String(item?.shortLink || '').trim();
            const url = String(item?.url || '').trim();
            const toId = short ? `trello:${short}` : (url || String(item?.name || '').trim());
            if (!toId) continue;
            ensureNode(toId);
            const state = String(item?.state || '').toLowerCase();
            const satisfied = state === 'complete';
            edges.push({ from: id, to: toId, satisfied, reason: satisfied ? 'trello_dep_complete' : 'trello_dep_incomplete', source: 'trello_checklist' });

            const nextDist = dist + 1;
            const prev = visited.get(toId);
            if (prev === undefined || nextDist < prev) {
              visited.set(toId, nextDist);
              queue.push({ id: toId, dist: nextDist });
            }
          }
        } catch {
          // ignore
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
      if (typeof e.satisfied === 'boolean') {
        return { from: e.from, to: e.to, satisfied: !!e.satisfied, reason: e.reason || 'known', source: e.source || null };
      }
      const resolved = resolvedById.get(e.to);
      return {
        from: e.from,
        to: e.to,
        satisfied: resolved ? !!resolved.satisfied : false,
        reason: resolved ? resolved.reason : 'unknown',
        source: e.source || null
      };
    });

    // Best-effort node enrichment for Trello + PR nodes.
    const nodeArr = Array.from(nodes.values());
    const trelloNodes = nodeArr.filter(n => n?.kind === 'trello');
    if (trelloNodes.length) {
      await Promise.allSettled(trelloNodes.map(async (n) => {
        const parsed = parseTrelloTaskId(n?.id);
        if (!parsed?.shortLink) return;
        const card = await this.getTrelloCardCached(parsed.shortLink);
        if (!card) return;
        const name = String(card?.name || '').trim();
        if (name) n.label = name;
        const url = String(card?.url || '').trim();
        if (url) n.url = url;
        if (card?.closed) n.doneAt = n.doneAt || 'trello_closed';
        n.trelloClosed = !!card?.closed;
      }));
    }

    const prNodes = nodeArr.filter(n => n?.kind === 'pr');
    if (prNodes.length) {
      await Promise.allSettled(prNodes.map(async (n) => {
        const parsed = parsePrTaskId(n?.id);
        if (!parsed) return;
        const prInfo = await this.getPrStateCached(parsed);
        const title = String(prInfo?.title || '').trim();
        if (title) n.label = title;
        const url = String(prInfo?.url || '').trim();
        if (url) n.url = url;
        const state = String(prInfo?.state || '').toLowerCase();
        if (state === 'merged') n.doneAt = n.doneAt || 'pr_merged';
      }));
    }

    const cycles = detectCycles({ nodeIds: nodeArr.map(n => n.id), edges: edgesResolved, limit: 5 });

    return {
      rootId: root,
      depth: maxDepth,
      nodes: nodeArr,
      edges: edgesResolved,
      cycles
    };
  }
}

module.exports = { TaskDependencyService, parsePrTaskId, parseTrelloTaskId, detectCycles };
