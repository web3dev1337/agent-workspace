const https = require('https');
const { execFile } = require('child_process');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const execFileAsync = (command, args, options) => new Promise((resolve, reject) => {
  const nextOptions = {
    ...getHiddenProcessOptions(options),
    env: augmentProcessEnv(options?.env || process.env)
  };
  execFile(command, args, nextOptions, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({ stdout, stderr });
  });
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/github-repo-service.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

function parseGitHubOwnerRepo(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return null;

  // Examples:
  // - https://github.com/owner/repo.git
  // - https://github.com/owner/repo
  // - git@github.com:owner/repo.git
  // - ssh://git@github.com/owner/repo.git
  const trimmed = remoteUrl.trim();

  let match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    match = trimmed.match(/github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  }
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;

  return { owner, repo };
}

function normalizeVisibility(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'public') return 'public';
  if (v === 'private') return 'private';
  // GitHub uses "internal" for enterprise orgs; map to "team" in our UI.
  if (v === 'internal') return 'team';
  return null;
}

class GitHubRepoService {
  constructor() {
    this.cache = new Map(); // key => { value, timestamp }
    this.cacheTtlMs = 12 * 60 * 60 * 1000; // 12h
    this.timeoutMs = 8000;

    this.listCache = new Map(); // key => { value, timestamp }
    this.listCacheTtlMs = 5 * 60 * 1000; // 5m
  }

  static getInstance() {
    if (!GitHubRepoService.instance) {
      GitHubRepoService.instance = new GitHubRepoService();
    }
    return GitHubRepoService.instance;
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return cached.value;
  }

  setCached(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
    return value;
  }

  getListCached(key) {
    const cached = this.listCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.listCacheTtlMs) {
      this.listCache.delete(key);
      return null;
    }
    return cached.value;
  }

  setListCached(key, value) {
    this.listCache.set(key, { value, timestamp: Date.now() });
    return value;
  }

  async listRepos({ owner = null, limit = 200, force = false } = {}) {
    const safeOwner = owner ? String(owner).trim() : '';
    const limitRaw = Number(limit);
    const safeLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 2000) : 200;
    const key = `repos:${safeOwner || '@me'}:${safeLimit}`;

    if (!force) {
      const cached = this.getListCached(key);
      if (cached) return cached;
    }

    const args = ['repo', 'list'];
    if (safeOwner) args.push(safeOwner);
    args.push(
      '--limit',
      String(safeLimit),
      '--json',
      'nameWithOwner,name,owner,isPrivate,visibility,isFork'
    );

    try {
      const { stdout } = await execFileAsync('gh', args, { timeout: Math.max(15000, this.timeoutMs) });
      const parsed = JSON.parse(stdout || '[]');
      const repos = Array.isArray(parsed) ? parsed : [];
      const normalized = repos.map((r) => {
        const nameWithOwner = String(r?.nameWithOwner || '').trim();
        const name = String(r?.name || '').trim();
        const ownerLogin = String(r?.owner?.login || '').trim();
        const visibility = normalizeVisibility(r?.visibility) || (r?.isPrivate ? 'private' : 'public');
        return {
          nameWithOwner,
          name,
          owner: ownerLogin,
          isPrivate: !!r?.isPrivate,
          isFork: !!r?.isFork,
          visibility: visibility || null
        };
      }).filter((r) => !!r.nameWithOwner);
      return this.setListCached(key, normalized);
    } catch (error) {
      logger.debug('gh repo list failed', { owner: safeOwner || '@me', error: error.message });
      throw new Error('Failed to list GitHub repos (requires `gh auth login`)');
    }
  }

  async getRepoVisibility(remoteUrl) {
    const parsed = parseGitHubOwnerRepo(remoteUrl);
    if (!parsed) return null;

    const key = `${parsed.owner}/${parsed.repo}`;
    const cached = this.getCached(key);
    if (cached) return cached;

    const visibility = await this.fetchVisibility(parsed.owner, parsed.repo);
    return this.setCached(key, visibility);
  }

  async fetchVisibility(owner, repo) {
    // Prefer gh CLI (works for private repos when user is authenticated).
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['repo', 'view', `${owner}/${repo}`, '--json', 'visibility', '--jq', '.visibility'],
        { timeout: this.timeoutMs }
      );
      const raw = (stdout || '').trim();
      const normalized = normalizeVisibility(raw);
      if (normalized) return normalized;
    } catch (error) {
      logger.debug('gh repo view failed; falling back to GitHub API', { owner, repo, error: error.message });
    }

    // Fallback: unauthenticated GitHub API (only works for public repos).
    try {
      const data = await this.fetchRepoMetadataViaApi(owner, repo);
      const normalized = normalizeVisibility(data?.visibility) || (data?.private ? 'private' : 'public');
      return normalized || null;
    } catch (error) {
      logger.debug('GitHub API visibility fetch failed', { owner, repo, error: error.message });
      return null;
    }
  }

  fetchRepoMetadataViaApi(owner, repo) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            'User-Agent': 'claude-orchestrator',
            'Accept': 'application/vnd.github+json'
          },
          timeout: this.timeoutMs
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`GitHub API status ${res.statusCode}`));
            }
            try {
              resolve(JSON.parse(body || 'null'));
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API request timed out'));
      });
    });
  }
}

module.exports = {
  GitHubRepoService,
  parseGitHubOwnerRepo,
  normalizeVisibility
};
