const fs = require('fs').promises;
const os = require('os');
const path = require('path');
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
      error.stdout = stdout;
      error.stderr = stderr;
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

function normalizeAffiliation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'all') {
    return 'owner,collaborator,organization_member';
  }
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.join(',') : 'owner,collaborator,organization_member';
}

function parseLineDelimitedJson(payload) {
  const lines = String(payload || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // ignore invalid lines
    }
  }
  return out;
}

function uniqueCommandCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const command = String(candidate || '').trim();
    if (!command) continue;
    const key = command.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(command);
  }
  return out;
}

function getGitHubCliCandidates(env = process.env, platform = process.platform) {
  const homeDir = env.HOME || os.homedir() || '';
  return uniqueCommandCandidates([
    platform === 'win32' ? 'gh.exe' : 'gh',
    'gh',
    platform === 'darwin' ? path.join(homeDir, '.homebrew', 'bin', 'gh') : '',
    platform === 'darwin' ? '/opt/homebrew/bin/gh' : '',
    platform === 'darwin' ? '/usr/local/bin/gh' : '',
    platform === 'win32' ? path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'gh.exe') : '',
    platform === 'win32' ? path.join(env.ProgramFiles || '', 'GitHub CLI', 'gh.exe') : '',
    platform === 'win32' ? path.join(env['ProgramFiles(x86)'] || '', 'GitHub CLI', 'gh.exe') : '',
    platform === 'win32' ? path.join(env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe') : ''
  ]);
}

function parseGitHubAuthOutput(stdout = '', stderr = '') {
  const combined = `${String(stdout || '')}\n${String(stderr || '')}`.trim();
  if (!combined) {
    return {
      authenticated: null,
      user: null,
      output: ''
    };
  }

  const userMatch = combined.match(/Logged in to github\.com(?:[^\n]*?)account\s+([^\s(]+)/i)
    || combined.match(/^\s*account:\s*([^\s(]+)/im)
    || combined.match(/^\s*user:\s*([^\s(]+)/im);
  const user = userMatch?.[1] || null;

  if (/Logged in to github\.com/i.test(combined) || /Active account:\s*true/i.test(combined)) {
    return {
      authenticated: true,
      user,
      output: combined
    };
  }

  if (
    /not logged into any github hosts/i.test(combined)
    || /authentication failed/i.test(combined)
    || /token in .* is no longer valid/i.test(combined)
    || /not logged in/i.test(combined)
  ) {
    return {
      authenticated: false,
      user: null,
      output: combined
    };
  }

  return {
    authenticated: null,
    user,
    output: combined
  };
}

function getGitHubHostsFileCandidates(env = process.env, platform = process.platform) {
  const homeDir = String(env.HOME || env.USERPROFILE || os.homedir() || '').trim();
  const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim();
  const appData = String(env.APPDATA || '').trim();

  return uniqueCommandCandidates([
    xdgConfigHome ? path.join(xdgConfigHome, 'gh', 'hosts.yml') : '',
    platform === 'win32' && appData ? path.join(appData, 'GitHub CLI', 'hosts.yml') : '',
    homeDir ? path.join(homeDir, '.config', 'gh', 'hosts.yml') : ''
  ]);
}

function parseGitHubHostsFile(contents, hostname = 'github.com') {
  const text = String(contents || '');
  if (!text.trim()) return null;

  const lines = text.split(/\r?\n/);
  const block = [];
  let inHostBlock = false;

  for (const line of lines) {
    const isTopLevel = /^[^\s].*:\s*$/.test(line);
    if (isTopLevel) {
      if (line.trim() === `${hostname}:`) {
        inHostBlock = true;
        continue;
      }
      if (inHostBlock) break;
    }
    if (inHostBlock) block.push(line);
  }

  if (!block.length) return null;

  const blockText = block.join('\n');
  const userMatch = blockText.match(/^\s+user:\s*"?([^"\n#]+?)"?\s*$/m);
  const tokenMatch = blockText.match(/^\s+(?:oauth_token|token):\s*"?([^"\n#]+?)"?\s*$/m);
  const user = userMatch?.[1]?.trim() || null;
  const hasToken = !!tokenMatch?.[1]?.trim();

  if (!user && !hasToken) {
    return {
      hasStoredAuth: false,
      user: null
    };
  }

  return {
    hasStoredAuth: true,
    user
  };
}

class GitHubRepoService {
  constructor() {
    this.cache = new Map(); // key => { value, timestamp }
    this.cacheTtlMs = 12 * 60 * 60 * 1000; // 12h
    this.timeoutMs = 8000;

    this.listCache = new Map(); // key => { value, timestamp }
    this.listCacheTtlMs = 5 * 60 * 1000; // 5m
    this.ghCommandCache = null;
    this.ghCommandCacheTtlMs = 5 * 60 * 1000;
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

  async resolveGhCommand({ force = false, env = process.env, platform = process.platform } = {}) {
    if (!force && this.ghCommandCache && (Date.now() - this.ghCommandCache.timestamp) <= this.ghCommandCacheTtlMs) {
      return this.ghCommandCache.command;
    }

    const candidates = getGitHubCliCandidates(env, platform);
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ['--version'], { timeout: this.timeoutMs, env });
        this.ghCommandCache = { command: candidate, timestamp: Date.now() };
        return candidate;
      } catch (error) {
        logger.debug('GitHub CLI candidate unavailable', { candidate, error: error.message });
      }
    }

    this.ghCommandCache = { command: null, timestamp: Date.now() };
    return null;
  }

  async getAuthStatus({ force = false, env = process.env, platform = process.platform } = {}) {
    const ghCommand = await this.resolveGhCommand({ force, env, platform });
    if (!ghCommand) {
      return {
        authenticated: false,
        user: null,
        ghInstalled: false,
        error: 'GitHub CLI not installed'
      };
    }

    let authProbe = null;
    try {
      const { stdout, stderr } = await execFileAsync(
        ghCommand,
        ['auth', 'status', '--hostname', 'github.com'],
        { timeout: Math.max(this.timeoutMs, 5000), env }
      );
      authProbe = parseGitHubAuthOutput(stdout, stderr);
      if (authProbe.authenticated === true) {
        return {
          authenticated: true,
          user: authProbe.user,
          ghInstalled: true
        };
      }
    } catch (error) {
      authProbe = parseGitHubAuthOutput(error?.stdout, error?.stderr || error?.message);
      if (authProbe.authenticated !== null) {
        return {
          authenticated: authProbe.authenticated,
          user: authProbe.user,
          ghInstalled: true,
          error: authProbe.authenticated ? null : 'Not authenticated'
        };
      }
      logger.debug('gh auth status probe was inconclusive', { command: ghCommand, error: error.message });
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        ghCommand,
        ['api', 'user', '--jq', '.login'],
        { timeout: this.timeoutMs, env }
      );
      const login = String(stdout || stderr || '').trim();
      if (login) {
        return {
          authenticated: true,
          user: login,
          ghInstalled: true
        };
      }
    } catch (error) {
      logger.debug('gh api user probe failed', { command: ghCommand, error: error.message });
    }

    const hostsFiles = getGitHubHostsFileCandidates(env, platform);
    for (const hostsPath of hostsFiles) {
      try {
        const parsed = parseGitHubHostsFile(await fs.readFile(hostsPath, 'utf8'));
        if (parsed?.hasStoredAuth) {
          return {
            authenticated: false,
            user: parsed.user,
            ghInstalled: true,
            error: 'GitHub auth status unavailable'
          };
        }
      } catch {
        // ignore missing or unreadable auth files
      }
    }

    return {
      authenticated: false,
      user: null,
      ghInstalled: true,
      error: authProbe?.authenticated === false ? 'Not authenticated' : 'GitHub auth status unavailable'
    };
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
      const ghCommand = await this.resolveGhCommand();
      if (!ghCommand) {
        throw new Error('GitHub CLI not installed');
      }
      const { stdout } = await execFileAsync(ghCommand, args, { timeout: Math.max(15000, this.timeoutMs) });
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

  async listAccessibleRepos({ limit = 200, force = false, affiliation = null } = {}) {
    const limitRaw = Number(limit);
    const safeLimit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 2000) : 200;
    const affiliationValue = normalizeAffiliation(affiliation);
    const key = `repos:accessible:${affiliationValue}:${safeLimit}`;

    if (!force) {
      const cached = this.getListCached(key);
      if (cached) return cached;
    }

    try {
      const ghCommand = await this.resolveGhCommand();
      if (!ghCommand) {
        throw new Error('GitHub CLI not installed');
      }

      const params = new URLSearchParams({
        per_page: '100',
        sort: 'updated',
        direction: 'desc',
        visibility: 'all',
        affiliation: affiliationValue
      });

      const args = [
        'api',
        `user/repos?${params.toString()}`,
        '--paginate',
        '--jq',
        '.[] | { nameWithOwner: .full_name, name: .name, owner: { login: .owner.login }, isPrivate: .private, visibility: .visibility, isFork: .fork, pushedAt: .pushed_at, updatedAt: .updated_at }'
      ];

      const { stdout } = await execFileAsync(ghCommand, args, { timeout: Math.max(20000, this.timeoutMs) });
      const parsed = parseLineDelimitedJson(stdout);
      const normalized = parsed.map((r) => {
        const nameWithOwner = String(r?.nameWithOwner || '').trim();
        const name = String(r?.name || '').trim();
        const ownerLogin = String(r?.owner?.login || r?.owner || '').trim();
        const visibility = normalizeVisibility(r?.visibility) || (r?.isPrivate ? 'private' : 'public');
        return {
          nameWithOwner,
          name,
          owner: ownerLogin,
          isPrivate: !!r?.isPrivate,
          isFork: !!r?.isFork,
          visibility: visibility || null,
          pushedAt: r?.pushedAt || null,
          updatedAt: r?.updatedAt || null
        };
      }).filter((r) => !!r.nameWithOwner);

      return this.setListCached(key, normalized.slice(0, safeLimit));
    } catch (error) {
      logger.debug('gh api user/repos failed', { error: error.message, affiliation: affiliationValue });
      throw new Error('Failed to list accessible GitHub repos (requires `gh auth login`)');
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
      const ghCommand = await this.resolveGhCommand();
      if (!ghCommand) {
        throw new Error('GitHub CLI not installed');
      }
      const { stdout } = await execFileAsync(
        ghCommand,
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
            'User-Agent': 'agent-workspace',
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
  normalizeVisibility,
  parseGitHubAuthOutput,
  parseGitHubHostsFile,
  getGitHubCliCandidates
};
