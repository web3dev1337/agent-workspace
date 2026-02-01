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

  async ghApi(path, { paginate = false, timeoutMs = 20000 } = {}) {
    const rawPath = String(path || '').trim().replace(/^\//, '');
    if (!rawPath) throw new Error('Invalid gh api path');

    const args = ['api', rawPath];
    if (paginate) args.push('--paginate');

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh api failed', { error: error.message, stderr, path: rawPath });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    const text = String(stdout || '').trim();
    if (!text) return null;

    const tryParse = (t) => {
      try {
        return { ok: true, value: JSON.parse(t) };
      } catch {
        return { ok: false, value: null };
      }
    };

    const direct = tryParse(text);
    if (direct.ok) return direct.value;

    // `gh api --paginate` prints each page's JSON response sequentially (often one JSON value per line).
    // To support older gh versions that lack `--slurp`, parse newline-delimited JSON and merge arrays.
    const lines = text.split('\n').map((l) => String(l || '').trim()).filter(Boolean);
    const parsedLines = lines.map(tryParse).filter((r) => r.ok).map((r) => r.value);
    if (!parsedLines.length) {
      throw new Error('Failed to parse gh api output');
    }
    if (parsedLines.every(Array.isArray)) {
      return parsedLines.flat();
    }
    // Fallback: return the last successfully parsed value.
    return parsedLines[parsedLines.length - 1];
  }

  async getPullRequestDetailsByUrl(prUrl, {
    maxFiles = 300,
    maxCommits = 200,
    maxComments = 100,
    maxReviews = 100
  } = {}) {
    const parsed = this.parsePullRequestUrl(prUrl);
    if (!parsed?.owner || !parsed?.repo || !parsed?.number) throw new Error('Invalid PR URL');

    const o = parsed.owner;
    const r = parsed.repo;
    const n = parsed.number;

    const clamp = (value, { min, max, fallback }) => {
      const v = Number(value);
      if (!Number.isFinite(v)) return fallback;
      return Math.min(Math.max(v, min), max);
    };

    const filesLimit = clamp(maxFiles, { min: 1, max: 2000, fallback: 300 });
    const commitsLimit = clamp(maxCommits, { min: 1, max: 2000, fallback: 200 });
    const commentsLimit = clamp(maxComments, { min: 0, max: 2000, fallback: 100 });
    const reviewsLimit = clamp(maxReviews, { min: 0, max: 2000, fallback: 100 });

    const [pr, filesRaw, commitsRaw, issueCommentsRaw, reviewsRaw] = await Promise.all([
      this.ghApi(`repos/${o}/${r}/pulls/${n}`, { paginate: false, timeoutMs: 20000 }).catch(() => null),
      this.ghApi(`repos/${o}/${r}/pulls/${n}/files`, { paginate: true, timeoutMs: 30000 }).catch(() => []),
      this.ghApi(`repos/${o}/${r}/pulls/${n}/commits`, { paginate: true, timeoutMs: 30000 }).catch(() => []),
      commentsLimit > 0
        ? this.ghApi(`repos/${o}/${r}/issues/${n}/comments`, { paginate: true, timeoutMs: 30000 }).catch(() => [])
        : Promise.resolve([]),
      reviewsLimit > 0
        ? this.ghApi(`repos/${o}/${r}/pulls/${n}/reviews`, { paginate: true, timeoutMs: 30000 }).catch(() => [])
        : Promise.resolve([])
    ]);

    const files = Array.isArray(filesRaw) ? filesRaw.slice(0, filesLimit).map((f) => ({
      filename: String(f?.filename || ''),
      previousFilename: f?.previous_filename ? String(f.previous_filename) : null,
      status: String(f?.status || ''),
      additions: Number.isFinite(Number(f?.additions)) ? Number(f.additions) : null,
      deletions: Number.isFinite(Number(f?.deletions)) ? Number(f.deletions) : null,
      changes: Number.isFinite(Number(f?.changes)) ? Number(f.changes) : null
    })).filter(f => f.filename) : [];

    const commits = Array.isArray(commitsRaw) ? commitsRaw.slice(0, commitsLimit).map((c) => ({
      sha: String(c?.sha || ''),
      message: String(c?.commit?.message || '').split('\n')[0] || '',
      author: c?.author?.login ? String(c.author.login) : (c?.commit?.author?.name ? String(c.commit.author.name) : ''),
      date: String(c?.commit?.author?.date || c?.commit?.committer?.date || '')
    })).filter(c => c.sha) : [];

    const issueComments = Array.isArray(issueCommentsRaw) ? issueCommentsRaw.slice(-commentsLimit).map((c) => ({
      id: c?.id,
      user: c?.user?.login ? String(c.user.login) : '',
      createdAt: String(c?.created_at || ''),
      updatedAt: String(c?.updated_at || ''),
      body: String(c?.body || '')
    })) : [];

    const reviews = Array.isArray(reviewsRaw) ? reviewsRaw.slice(-reviewsLimit).map((rv) => ({
      id: rv?.id,
      user: rv?.user?.login ? String(rv.user.login) : '',
      state: String(rv?.state || ''),
      submittedAt: String(rv?.submitted_at || ''),
      body: String(rv?.body || '')
    })) : [];

    const prSummary = pr && typeof pr === 'object' ? {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url || parsed.url,
      isDraft: !!pr.draft,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      closedAt: pr.closed_at,
      mergeable: pr.mergeable,
      baseRefName: pr.base?.ref,
      headRefName: pr.head?.ref,
      author: pr.user?.login || null
    } : {
      number: n,
      title: null,
      state: null,
      url: parsed.url
    };

    return {
      pr: prSummary,
      files,
      commits,
      conversation: {
        issueComments,
        reviews
      }
    };
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

  async reviewPullRequestByUrl(prUrl, { action = 'comment', body = '' } = {}) {
    const parsed = this.parsePullRequestUrl(prUrl);
    if (!parsed?.url) throw new Error('Invalid PR URL');

    const normalizedAction = String(action || 'comment').trim().toLowerCase().replace(/-/g, '_');
    const flag = normalizedAction === 'approve'
      ? '--approve'
      : (normalizedAction === 'request_changes' ? '--request-changes' : '--comment');

    const args = ['pr', 'review', parsed.url, flag];
    const text = String(body || '').trim();
    if (text) args.push('--body', text);

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh pr review failed', { error: error.message, stderr, url: parsed.url, action: normalizedAction });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    return { ok: true, url: parsed.url, action: normalizedAction, stdout: String(stdout || '') };
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
