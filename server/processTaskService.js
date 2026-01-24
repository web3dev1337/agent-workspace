const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/process-tasks.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class ProcessTaskService {
  constructor({ sessionManager, worktreeTagService, pullRequestService } = {}) {
    this.sessionManager = sessionManager;
    this.worktreeTagService = worktreeTagService;
    this.pullRequestService = pullRequestService;
  }

  static getInstance(deps = {}) {
    if (!ProcessTaskService.instance) {
      ProcessTaskService.instance = new ProcessTaskService(deps);
    }
    return ProcessTaskService.instance;
  }

  listWaitingSessions() {
    if (!this.sessionManager?.sessions || typeof this.sessionManager.sessions.values !== 'function') {
      return [];
    }

    const sessions = [];
    for (const session of this.sessionManager.sessions.values()) {
      if (session?.status !== 'waiting') continue;
      sessions.push({
        id: `session:${session.id}`,
        kind: 'session',
        status: 'waiting',
        title: `${session.repositoryName || 'repo'} ${session.worktreeId || session.id}`.trim(),
        sessionId: session.id,
        sessionType: session.type,
        worktreeId: session.worktreeId || null,
        repositoryName: session.repositoryName || null,
        repositoryType: session.repositoryType || null,
        worktreePath: session.config?.cwd || null,
        updatedAt: session.statusChangedAt ? new Date(session.statusChangedAt).toISOString() : null
      });
    }
    return sessions;
  }

  listReadyForReviewWorktrees() {
    const tags = this.worktreeTagService?.getAll?.() || {};
    const tasks = [];

    for (const [worktreePath, tag] of Object.entries(tags)) {
      if (!tag?.readyForReview) continue;
      tasks.push({
        id: `worktree:${worktreePath}`,
        kind: 'worktree',
        status: 'ready_for_review',
        title: worktreePath,
        worktreePath,
        updatedAt: tag.updatedAt || null
      });
    }

    return tasks;
  }

  async listPRTasks(params = {}) {
    if (!this.pullRequestService?.searchPullRequests) return [];

    const result = await this.pullRequestService.searchPullRequests({
      mode: params.mode || 'mine',
      state: params.state || 'open',
      sort: params.sort || 'updated',
      limit: params.limit || 50,
      query: params.query || '',
      repos: params.repos || [],
      owners: params.owners || []
    });

    return (result.prs || []).map(pr => {
      const owner = pr?.repository?.owner?.login || pr?.repository?.owner?.name || null;
      const name = pr?.repository?.name || null;
      const repoSlug = owner && name ? `${owner}/${name}` : null;

      return {
        id: repoSlug && pr?.number ? `pr:${repoSlug}#${pr.number}` : `pr:${pr?.url || pr?.number || Math.random()}`,
        kind: 'pr',
        status: pr?.state || 'unknown',
        title: pr?.title || `PR #${pr?.number || '?'}`,
        prNumber: pr?.number || null,
        url: pr?.url || null,
        repository: repoSlug,
        author: pr?.author?.login || null,
        updatedAt: pr?.updatedAt || pr?.createdAt || null,
        createdAt: pr?.createdAt || null,
        isDraft: !!pr?.isDraft
      };
    });
  }

  async listTasks(params = {}) {
    try {
      const [prs, ready, waiting] = await Promise.all([
        this.listPRTasks(params.prs || {}),
        Promise.resolve(this.listReadyForReviewWorktrees()),
        Promise.resolve(this.listWaitingSessions())
      ]);

      const tasks = [...prs, ...ready, ...waiting];
      tasks.sort((a, b) => {
        const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bt - at;
      });

      return tasks;
    } catch (error) {
      logger.error('Failed to list tasks', { error: error.message, stack: error.stack });
      throw error;
    }
  }
}

module.exports = { ProcessTaskService };

