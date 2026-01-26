const winston = require('winston');
const path = require('path');

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

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_WIP_MAX = 3;
const DEFAULT_Q12_CAP = 3;
const DEFAULT_Q3_CAP = 6;
const DEFAULT_Q4_CAP = 10;

const parseIso = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
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

const normalizeTier = (value) => {
  const tier = Number(value);
  return tier >= 1 && tier <= 4 ? tier : null;
};

const computeQueueCounts = ({ tasks, taskRecordService }) => {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 };
  for (const task of (Array.isArray(tasks) ? tasks : [])) {
    const record = taskRecordService?.get?.(task?.id) || null;
    const tier = normalizeTier(record?.tier);
    if (!tier) counts.none += 1;
    else counts[tier] += 1;
  }

  const q12 = counts[1] + counts[2];
  const qTotal = counts[1] + counts[2] + counts[3] + counts[4] + counts.none;
  return { counts, q12, qTotal };
};

const computeWipFromSessions = ({ sessionManager, lookbackHours }) => {
  const sessions = sessionManager?.sessions;
  if (!sessions || typeof sessions.values !== 'function') return null;

  const cutoff = Date.now() - (Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS) * 60 * 60 * 1000;
  const repos = new Set();

  for (const session of sessions.values()) {
    const status = String(session?.status || '').toLowerCase();
    if (status === 'stopped' || status === 'idle') continue;

    const updatedAt = parseIso(session?.statusChangedAt || session?.lastActiveAt || session?.updatedAt || null);
    if (updatedAt && updatedAt < cutoff) continue;

    const name = String(session?.repositoryName || '').trim();
    if (name) {
      repos.add(name);
      continue;
    }

    const cwd = session?.config?.cwd || null;
    if (cwd) repos.add(deriveProjectRootFromWorktreePath(cwd));
  }

  return { wip: repos.size, kind: 'sessions' };
};

const computeWipFromWorkspaces = ({ workspaceManager, lookbackHours }) => {
  const workspaces = workspaceManager?.workspaces;
  if (!workspaces || typeof workspaces.values !== 'function') return { wip: 0, kind: 'workspaces' };

  const cutoff = Date.now() - (Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS) * 60 * 60 * 1000;
  let wip = 0;
  for (const ws of workspaces.values()) {
    const t = parseIso(ws?.lastAccess || ws?.updatedAt || null);
    if (t && t >= cutoff) wip += 1;
  }
  return { wip, kind: 'workspaces' };
};

const computeLevel = ({ wip, q12, q3, q4, caps }) => {
  const reasons = [];
  let level = 'ok';

  if (wip > (caps?.wipMax ?? DEFAULT_WIP_MAX)) {
    level = 'warn';
    reasons.push('wip');
  }

  if (q12 > (caps?.q12 ?? DEFAULT_Q12_CAP)) {
    level = 'warn';
    reasons.push('q12');
  }

  if (q3 > (caps?.q3 ?? DEFAULT_Q3_CAP)) {
    level = 'warn';
    reasons.push('q3');
  }

  if (q4 > (caps?.q4 ?? DEFAULT_Q4_CAP)) {
    level = 'warn';
    reasons.push('q4');
  }

  return { level, reasons };
};

const computeLaunchAllowedByTier = ({ wip, qByTier, q12, caps }) => {
  const maximumAllowedWip = caps?.wipMax ?? DEFAULT_WIP_MAX;
  const maximumAllowedTier12Queue = caps?.q12 ?? DEFAULT_Q12_CAP;
  const maximumAllowedTier3Queue = caps?.q3 ?? DEFAULT_Q3_CAP;
  const maximumAllowedTier4Queue = caps?.q4 ?? DEFAULT_Q4_CAP;

  const isWorkInProgressWithinCap = wip <= maximumAllowedWip;
  const isTier12QueueWithinCap = q12 <= maximumAllowedTier12Queue;

  const tier3QueueSize = Number(qByTier?.[3] ?? 0);
  const tier4QueueSize = Number(qByTier?.[4] ?? 0);
  const isTier3QueueWithinCap = tier3QueueSize <= maximumAllowedTier3Queue;
  const isTier4QueueWithinCap = tier4QueueSize <= maximumAllowedTier4Queue;

  return {
    1: isWorkInProgressWithinCap && isTier12QueueWithinCap,
    2: isWorkInProgressWithinCap && isTier12QueueWithinCap,
    3: isWorkInProgressWithinCap && isTier3QueueWithinCap,
    4: isWorkInProgressWithinCap && isTier4QueueWithinCap
  };
};

class ProcessStatusService {
  constructor({ processTaskService, taskRecordService, sessionManager, workspaceManager } = {}) {
    this.processTaskService = processTaskService;
    this.taskRecordService = taskRecordService;
    this.sessionManager = sessionManager;
    this.workspaceManager = workspaceManager;
    this.cache = new TTLCache({ defaultTtlMs: 25_000, maxEntries: 50 });
  }

  static getInstance(deps = {}) {
    if (!ProcessStatusService.instance) {
      ProcessStatusService.instance = new ProcessStatusService(deps);
    }
    return ProcessStatusService.instance;
  }

  async getStatus({ mode = 'mine', lookbackHours = DEFAULT_LOOKBACK_HOURS, force = false } = {}) {
    const cacheKey = `status:${mode}:${Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS}`;
    return this.cache.getOrCompute(cacheKey, async () => {
      const caps = {
        wipMax: DEFAULT_WIP_MAX,
        q12: DEFAULT_Q12_CAP,
        q3: DEFAULT_Q3_CAP,
        q4: DEFAULT_Q4_CAP
      };

      const sessionWip = computeWipFromSessions({ sessionManager: this.sessionManager, lookbackHours });
      const wip = sessionWip || computeWipFromWorkspaces({ workspaceManager: this.workspaceManager, lookbackHours });

      let tasks = [];
      if (this.processTaskService?.listTasks) {
        try {
          tasks = await this.processTaskService.listTasks({ prs: { mode, state: 'open', sort: 'updated', limit: 50 } });
        } catch (error) {
          logger.warn('Failed to list process tasks for status; continuing with empty queue', { error: error.message });
          tasks = [];
        }
      }

      const queue = computeQueueCounts({ tasks, taskRecordService: this.taskRecordService });
      const qByTier = queue.counts;

      const level = computeLevel({
        wip: wip.wip,
        q12: queue.q12,
        q3: qByTier[3],
        q4: qByTier[4],
        caps
      });

      return {
        mode,
        lookbackHours: Number(lookbackHours) || DEFAULT_LOOKBACK_HOURS,
        wip: wip.wip,
        wipKind: wip.kind,
        wipMax: caps.wipMax,
        qByTier,
        q12: queue.q12,
        qTotal: queue.qTotal,
        qCaps: { q12: caps.q12, q3: caps.q3, q4: caps.q4 },
        level: level.level,
        reasons: level.reasons,
        launchAllowedByTier: computeLaunchAllowedByTier({
          wip: wip.wip,
          qByTier,
          q12: queue.q12,
          caps
        })
      };
    }, { force });
  }
}

module.exports = {
  ProcessStatusService,
  computeQueueCounts,
  computeWipFromSessions,
  computeWipFromWorkspaces,
  computeLaunchAllowedByTier
};
