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

  splitJsonStream(text) {
    const s = String(text || '');
    const out = [];

    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (start === -1) {
        if (ch === '{' || ch === '[') {
          start = i;
          depth = 1;
          inString = false;
          escape = false;
        }
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;

      if (depth === 0) {
        out.push(s.slice(start, i + 1));
        start = -1;
      }
    }

    return out;
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

  async getPullRequest({ owner, repo, number, fields = null }) {
    const o = String(owner || '').trim();
    const r = String(repo || '').trim();
    const n = Number(number);
    if (!o || !r || !Number.isFinite(n)) {
      throw new Error('Invalid PR identifier');
    }

    const defaultFields = [
      'number',
      'title',
      'state',
      'url',
      'isDraft',
      'createdAt',
      'updatedAt',
      'author',
      'body',
      'mergedAt',
      'closedAt'
    ];
    const provided = Array.isArray(fields)
      ? fields.map((x) => String(x || '').trim()).filter(Boolean)
      : (typeof fields === 'string'
        ? String(fields).split(',').map((x) => String(x || '').trim()).filter(Boolean)
        : null);
    const jsonFields = (provided && provided.length) ? provided : defaultFields;

    const args = [
      'pr',
      'view',
      String(n),
      '--repo',
      `${o}/${r}`,
      '--json',
      jsonFields.join(',')
    ];

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
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

  async ghApi(path, { paginate = false, timeoutMs = 20000, params = null, method = 'GET' } = {}) {
    const rawPath = String(path || '').trim().replace(/^\//, '');
    if (!rawPath) throw new Error('Invalid gh api path');

    const args = ['api', rawPath];
    // IMPORTANT: `gh api` implicitly switches to POST when `-f` is used unless a method is forced.
    // We use `-f` for query params, so default to GET unless explicitly overridden.
    const m = String(method || 'GET').trim().toUpperCase() || 'GET';
    args.push('--method', m);
    if (paginate) args.push('--paginate');
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      args.push('-f', `${key}=${value}`);
    });

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
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

    // `gh api --paginate` prints each page's JSON response sequentially.
    // On some installs it may be pretty-printed and/or not strictly newline-delimited, so parse it as a JSON stream.
    const chunks = this.splitJsonStream(text);
    const parsed = chunks.map(tryParse).filter((r) => r.ok).map((r) => r.value);
    if (!parsed.length) throw new Error('Failed to parse gh api output');
    if (parsed.every(Array.isArray)) return parsed.flat();
    return parsed[parsed.length - 1];
  }

  async ghApiGetAllPages(path, { params = {}, perPage = 100, maxPages = 25, timeoutMs = 20000 } = {}) {
    const rawPath = String(path || '').trim().replace(/^\//, '');
    if (!rawPath) throw new Error('Invalid gh api path');

    const p = Number(perPage);
    const per = Number.isFinite(p) ? Math.min(Math.max(p, 1), 100) : 100;
    const m = Number(maxPages);
    const pages = Number.isFinite(m) ? Math.min(Math.max(m, 1), 50) : 25;

    const all = [];
    for (let page = 1; page <= pages; page += 1) {
      const pageData = await this.ghApi(rawPath, {
        paginate: false,
        timeoutMs,
        params: { ...(params || {}), per_page: per, page }
      });
      if (!Array.isArray(pageData)) {
        throw new Error(`Expected array from gh api (${rawPath}), got ${typeof pageData}`);
      }
      all.push(...pageData);
      if (pageData.length < per) break;
    }
    return all;
  }

  async ghGraphql(query, variables = {}, { timeoutMs = 30000 } = {}) {
    const q = String(query || '').trim();
    if (!q) throw new Error('Invalid GraphQL query');

    const args = ['api', 'graphql', '--method', 'POST', '-f', `query=${q}`];

    const varEntries = Object.entries(variables || {});
    for (const [key, value] of varEntries) {
      const k = String(key || '').trim();
      if (!k) continue;
      if (value === undefined) continue;

      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        const v = value === null ? 'null' : String(value);
        args.push('-F', `${k}=${v}`);
      } else {
        args.push('-f', `${k}=${String(value)}`);
      }
    }

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          logger.error('gh graphql failed', { error: error.message, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    const parsed = JSON.parse(stdout || '{}');
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.errors) && parsed.errors.length) {
      const msg = parsed.errors.map((e) => String(e?.message || '').trim()).filter(Boolean).join('; ');
      const err = new Error(msg || 'GraphQL request failed');
      err.graphqlErrors = parsed.errors;
      throw err;
    }
    return parsed;
  }

  async getPullRequestFilesByGraphql({ owner, repo, number, limit = 300 } = {}) {
    const o = String(owner || '').trim();
    const r = String(repo || '').trim();
    const n = Number(number);
    if (!o || !r || !Number.isFinite(n)) {
      throw new Error('Invalid PR identifier');
    }

    const max = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 2000) : 300;

    const query = `
      query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            files(first: 100, after: $after) {
              nodes {
                path
                additions
                deletions
                changeType
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `.trim().replace(/\s+/g, ' ');

    const out = [];
    let after = null;
    while (out.length < max) {
      const res = await this.ghGraphql(query, { owner: o, repo: r, number: n, after }, { timeoutMs: 30000 });
      const files = res?.data?.repository?.pullRequest?.files;
      const nodes = Array.isArray(files?.nodes) ? files.nodes : [];
      nodes.forEach((f) => out.push(f));

      const pageInfo = files?.pageInfo || {};
      if (!pageInfo?.hasNextPage) break;
      after = pageInfo.endCursor || null;
      if (!after) break;
    }

    return out.slice(0, max);
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

    const maxPagesFor = (limit, perPage = 100) => {
      const l = Number(limit);
      if (!Number.isFinite(l) || l <= 0) return 1;
      return Math.min(Math.ceil(l / perPage) + 1, 50);
    };

    const safe = async (endpoint, fn, fallback) => {
      try {
        const value = await fn();
        return { ok: true, value, endpoint, error: null };
      } catch (e) {
        const msg = String(e?.message || e || 'Unknown error');
        logger.warn('PR details fetch failed', { endpoint, error: msg, owner: o, repo: r, number: n });
        return { ok: false, value: fallback, endpoint, error: msg };
      }
    };

    const prViewFields = [
      'number',
      'title',
      'state',
      'url',
      'isDraft',
      'createdAt',
      'updatedAt',
      'mergedAt',
      'closedAt',
      'mergeable',
      'baseRefName',
      'headRefName',
      'author',
      // Commits are fetched via REST (`/pulls/:n/commits`) for reliability.
    ];

    const [prViewRes, filesRes, commitsRes, issueCommentsRes, reviewsRes] = await Promise.all([
      safe(`gh pr view ${o}/${r}#${n}`, () => this.getPullRequest({ owner: o, repo: r, number: n, fields: prViewFields }), null),
      // Prefer REST here: GraphQL sometimes returns { errors: [...] } while still exiting 0, which previously
      // looked like "0 files" with no warnings. REST gives us status + rename info too.
      safe(
        `repos/${o}/${r}/pulls/${n}/files`,
        () => this.ghApiGetAllPages(`repos/${o}/${r}/pulls/${n}/files`, { timeoutMs: 30000, maxPages: maxPagesFor(filesLimit, 100) }),
        []
      ),
      safe(
        `repos/${o}/${r}/pulls/${n}/commits`,
        () => this.ghApiGetAllPages(`repos/${o}/${r}/pulls/${n}/commits`, { timeoutMs: 30000, maxPages: maxPagesFor(commitsLimit, 100) }),
        []
      ),
      commentsLimit > 0
        ? safe(`repos/${o}/${r}/issues/${n}/comments`, () => this.ghApiGetAllPages(`repos/${o}/${r}/issues/${n}/comments`, { timeoutMs: 30000, maxPages: maxPagesFor(commentsLimit, 100) }), [])
        : Promise.resolve({ ok: true, value: [], endpoint: null, error: null }),
      reviewsLimit > 0
        ? safe(`repos/${o}/${r}/pulls/${n}/reviews`, () => this.ghApiGetAllPages(`repos/${o}/${r}/pulls/${n}/reviews`, { timeoutMs: 30000, maxPages: maxPagesFor(reviewsLimit, 100) }), [])
        : Promise.resolve({ ok: true, value: [], endpoint: null, error: null })
    ]);

    const prRaw = prViewRes.value;
    const filesRaw = filesRes.value;
    const commitsRaw = commitsRes.value;
    const issueCommentsRaw = issueCommentsRes.value;
    const reviewsRaw = reviewsRes.value;

    const warnings = [prViewRes, filesRes, commitsRes, issueCommentsRes, reviewsRes]
      .filter((x) => x && x.ok === false)
      .map((x) => ({ endpoint: x.endpoint, error: x.error }));

    const files = Array.isArray(filesRaw) ? filesRaw.slice(0, filesLimit).map((f) => {
      const filename = String(f?.filename || f?.path || '');
      const previousFilename = f?.previous_filename ? String(f.previous_filename) : (f?.previousFilename ? String(f.previousFilename) : null);

      const statusRaw = String(f?.status || '').trim().toLowerCase();
      const normalizeStatus = (raw) => {
        const s = String(raw || '').trim().toLowerCase();
        if (!s) return '';
        if (s === 'added') return 'added';
        if (s === 'modified' || s === 'changed') return 'modified';
        if (s === 'removed' || s === 'deleted') return 'removed';
        if (s === 'renamed') return 'renamed';
        if (s === 'copied') return 'added';
        return s;
      };

      let status = normalizeStatus(statusRaw);

      // Back-compat: older code paths used GraphQL `changeType`.
      if (!status) {
        const statusMap = new Map([
          ['ADDED', 'added'],
          ['MODIFIED', 'modified'],
          ['DELETED', 'removed'],
          ['RENAMED', 'renamed']
        ]);
        const changeType = String(f?.changeType || '').trim().toUpperCase();
        status = statusMap.get(changeType) || '';
      }
      const additions = Number.isFinite(Number(f?.additions)) ? Number(f.additions) : null;
      const deletions = Number.isFinite(Number(f?.deletions)) ? Number(f.deletions) : null;
      const changes = (additions != null && deletions != null) ? (additions + deletions) : null;
      return {
        filename,
        previousFilename: previousFilename || null,
        status,
        additions,
        deletions,
        changes
      };
    }).filter(f => f.filename) : [];

    const commits = Array.isArray(commitsRaw) ? commitsRaw.slice(0, commitsLimit).map((c) => {
      const sha = String(c?.sha || '').trim();
      const msgRaw = String(c?.commit?.message || '').trim();
      const message = msgRaw ? msgRaw.split('\n')[0] : '';
      const author = c?.author?.login
        ? String(c.author.login)
        : (c?.commit?.author?.name ? String(c.commit.author.name) : '');
      const date = String(c?.commit?.author?.date || c?.commit?.committer?.date || '');
      return { sha, message, author, date };
    }).filter((c) => c.sha) : [];

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

    const prSummary = prRaw && typeof prRaw === 'object' ? {
      number: prRaw.number ?? n,
      title: prRaw.title || null,
      state: prRaw.state || null,
      url: prRaw.url || parsed.url,
      isDraft: !!prRaw.isDraft,
      createdAt: prRaw.createdAt || null,
      updatedAt: prRaw.updatedAt || null,
      mergedAt: prRaw.mergedAt || null,
      closedAt: prRaw.closedAt || null,
      mergeable: prRaw.mergeable ?? null,
      baseRefName: prRaw.baseRefName || null,
      headRefName: prRaw.headRefName || null,
      author: prRaw.author?.login ? String(prRaw.author.login) : null
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
      },
      warnings
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
      execFile('gh', args, { timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
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
    if (text) {
      args.push('--body', text);
    } else if (normalizedAction === 'request_changes') {
      // gh pr review --request-changes requires --body or it opens an interactive editor
      args.push('--body', 'Changes requested.');
    }

    const { stdout } = await new Promise((resolve, reject) => {
      execFile('gh', args, { timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
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
      execFile('gh', args, { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
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
