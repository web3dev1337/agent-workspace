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
}

module.exports = { TaskDependencyService, parsePrTaskId };

