const { execFile } = require('child_process');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/pull-requests.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class PullRequestService {
  static getInstance() {
    if (!PullRequestService.instance) {
      PullRequestService.instance = new PullRequestService();
    }
    return PullRequestService.instance;
  }

  parsePullRequestUrl(prUrl) {
    const raw = String(prUrl || '').trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
      if (!m) return null;
      return { owner: m[1], repo: m[2], number: Number(m[3]), url: u.toString() };
    } catch {
      return null;
    }
  }

  async getPullRequest({ owner, repo, number }) {
    const o = String(owner || '').trim();
    const r = String(repo || '').trim();
    const n = Number(number);
    if (!o || !r || !Number.isFinite(n)) {
      throw new Error('Invalid PR identifier');
    }

    const args = [
      'pr',
      'view',
      String(n),
      '--repo',
      `${o}/${r}`,
      '--json',
      'number,title,state,url,isDraft,createdAt,updatedAt,author,body,mergedAt,closedAt'
    ];

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh pr view failed', { error: error.message, stderr, owner: o, repo: r, number: n });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    return JSON.parse(stdout || '{}');
  }

  async mergePullRequestByUrl(prUrl, { method = 'merge', auto = false } = {}) {
    const parsed = this.parsePullRequestUrl(prUrl);
    if (!parsed?.url) throw new Error('Invalid PR URL');

    const normalized = String(method || 'merge').trim().toLowerCase();
    const mergeFlag = normalized === 'squash'
      ? '--squash'
      : (normalized === 'rebase' ? '--rebase' : '--merge');

    const args = ['pr', 'merge', parsed.url, mergeFlag];
    if (auto) args.push('--auto');

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh pr merge failed', { error: error.message, stderr, url: parsed.url });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    return { ok: true, url: parsed.url, stdout: String(stdout || '') };
  }

  normalizeListParams(params = {}) {
    const mode = String(params.mode || 'mine').toLowerCase(); // mine | involved | all
    const state = String(params.state || 'all').toLowerCase(); // all | open | closed | merged
    const sort = String(params.sort || 'updated').toLowerCase(); // updated | created
    const limitRaw = parseInt(params.limit ?? '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const query = typeof params.query === 'string' ? params.query.trim() : '';

    const repos = Array.isArray(params.repos)
      ? params.repos.map(r => String(r).trim()).filter(Boolean).slice(0, 20)
      : [];
    const owners = Array.isArray(params.owners)
      ? params.owners.map(o => String(o).trim()).filter(Boolean).slice(0, 20)
      : [];

    if (!['updated', 'created'].includes(sort)) {
      throw new Error('Invalid sort (expected updated|created)');
    }
    if (!['mine', 'involved', 'all'].includes(mode)) {
      throw new Error('Invalid mode (expected mine|involved|all)');
    }
    if (!['all', 'open', 'closed', 'merged'].includes(state)) {
      throw new Error('Invalid state (expected all|open|closed|merged)');
    }

    return { mode, state, sort, limit, query, repos, owners };
  }

  async searchPullRequests(params = {}) {
    const { mode, state, sort, limit, query, repos, owners } = this.normalizeListParams(params);

    const args = [
      'search',
      'prs',
      '--sort',
      sort,
      '--order',
      'desc',
      '--limit',
      String(limit),
      '--json',
      'number,title,state,url,isDraft,repository,createdAt,updatedAt,author'
    ];

    if (mode === 'mine') {
      args.push('--author', '@me');
    } else if (mode === 'involved') {
      args.push('--involves', '@me');
    }

    const queryParts = [];

    if (state === 'open' || state === 'closed') {
      args.push('--state', state);
      if (state === 'closed') queryParts.push('-is:merged');
    } else if (state === 'merged') {
      args.push('--merged');
    }

    owners.forEach(owner => args.push('--owner', owner));
    repos.forEach(repo => args.push('--repo', repo));
    if (query) queryParts.push(query);
    if (queryParts.length) args.push('--', ...queryParts);

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh search prs failed', { error: error.message, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
    const prs = JSON.parse(stdout || '[]');

    return {
      mode,
      state,
      sort,
      limit,
      query,
      repos,
      owners,
      count: Array.isArray(prs) ? prs.length : 0,
      prs: Array.isArray(prs) ? prs : []
    };
  }
}

module.exports = { PullRequestService };
