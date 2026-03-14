const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const execFileAsync = util.promisify(execFile);

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

async function execFileSafe(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...getHiddenProcessOptions(options),
    env: augmentProcessEnv(options.env || process.env),
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER
  });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/git.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Configuration constants
const GIT_CACHE_TIMEOUT_MS = 30000; // 30 seconds
const GIT_COMMAND_TIMEOUT_MS = 5000; // 5 seconds
const GIT_LONG_COMMAND_TIMEOUT_MS = 10000; // 10 seconds for slow operations
const PR_CACHE_TIMEOUT_MS = 300000; // 5 minutes

class GitHelper {
  constructor() {
    // Cache branch names to reduce git calls
    this.branchCache = new Map();
    this.cacheTimeout = GIT_CACHE_TIMEOUT_MS;
    this.prCache = new Map();
    this.prCacheTimeout = PR_CACHE_TIMEOUT_MS;

    // Store base path for validation
    this.basePath = process.env.WORKTREE_BASE_PATH || process.env.HOME || os.homedir();

    // If specific worktree pattern is needed, it can be configured
    this.worktreePattern = process.env.WORKTREE_PATTERN || null;

    // Throttle noisy path validation logs (keyed by `${reason}:${normalizedPath}`)
    this.pathWarnedAt = new Map();
    this.pathWarnThrottleMs = 5 * 60 * 1000; // 5 minutes
  }

  warnPathOnce(reason, worktreePath, extra = {}) {
    const normalized = (() => {
      try { return path.resolve(String(worktreePath || '').trim()); } catch { return String(worktreePath || ''); }
    })();
    const key = `${String(reason || 'unknown')}:${normalized}`;
    const now = Date.now();
    const last = this.pathWarnedAt.get(key) || 0;
    if (now - last < this.pathWarnThrottleMs) return;
    this.pathWarnedAt.set(key, now);
    logger.warn('Worktree path not usable for git operations', { reason, path: worktreePath, ...extra });
  }

  getPathState(worktreePath) {
    const raw = String(worktreePath || '').trim();
    if (!raw) return { ok: false, reason: 'empty', normalized: '' };

    let normalized = raw;
    try { normalized = path.resolve(raw); } catch {}

    if (!this.isValidPath(normalized)) {
      return { ok: false, reason: 'invalid', normalized };
    }

    // Avoid spawning `/bin/sh` when cwd doesn't exist (Node reports ENOENT as "spawn /bin/sh ENOENT").
    try {
      if (!fs.existsSync(normalized)) {
        return { ok: false, reason: 'missing', normalized };
      }
    } catch {
      return { ok: false, reason: 'missing', normalized };
    }

    return { ok: true, reason: null, normalized };
  }

  gitEnv(extraEnv = {}) {
    return {
      ...process.env,
      // Ignore system git config for security, but do not override HOME:
      // overriding HOME prevents reading user-level git config (e.g. safe.directory),
      // which can cause branch detection to fail and leave UI stuck on "unknown".
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: process.env.HOME || os.homedir(),
      ...extraEnv
    };
  }

  async execGit(args, { cwd, timeout } = {}) {
    return execFileSafe('git', args, {
      cwd,
      timeout: timeout ?? GIT_COMMAND_TIMEOUT_MS,
      env: this.gitEnv()
    });
  }

  async execGh(args, { cwd, timeout, env } = {}) {
    return execFileSafe('gh', args, {
      cwd,
      timeout: timeout ?? GIT_LONG_COMMAND_TIMEOUT_MS,
      env: { ...process.env, ...(env || {}) }
    });
  }
  
  async getCurrentBranch(worktreePath, skipCache = false) {
    logger.info('🔍 getCurrentBranch called', { 
      path: worktreePath, 
      skipCache,
      timestamp: new Date().toISOString()
    });
    
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      // Return a stable sentinel so callers stop retrying forever.
      return state.reason === 'invalid' ? 'invalid-path' : (state.reason === 'missing' ? 'missing' : 'unknown');
    }
    
    // Check cache first (unless explicitly skipped)
    if (!skipCache) {
      const cached = this.getCachedBranch(state.normalized);
      if (cached) {
        logger.debug('Using cached branch', { path: worktreePath, branch: cached });
        return cached;
      }
    }
    
    try {
      // Use git to get current branch
      const { stdout, stderr } = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: state.normalized,
        timeout: GIT_COMMAND_TIMEOUT_MS
      });
      
      if (stderr) {
        logger.warn('Git command produced stderr', { 
          path: worktreePath, 
          stderr: stderr.trim() 
        });
      }
      
      const branch = stdout.trim();
      logger.debug('Git returned branch', { path: worktreePath, branch });
      
      // Handle detached HEAD state
      if (branch === 'HEAD') {
        // Try to get commit hash instead
        const { stdout: commitHash } = await this.execGit(['rev-parse', '--short', 'HEAD'], {
          cwd: state.normalized,
          timeout: 5000
        });
        
        const shortHash = commitHash.trim();
        this.setCachedBranch(state.normalized, `detached@${shortHash}`);
        return `detached@${shortHash}`;
      }
      
      // Cache the result
      this.setCachedBranch(state.normalized, branch);
      return branch;
      
    } catch (error) {
      logger.error('Failed to get git branch', { 
        path: state.normalized || worktreePath,
        error: error.message 
      });
      
      // Check if it's not a git repository
      if (String(error?.message || '').includes('not a git repository')) {
        return 'no-git';
      }
      
      return 'unknown';
    }
  }
  
  async getStatus(worktreePath) {
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      return null;
    }
    
    try {
      const { stdout } = await this.execGit(['status', '--porcelain'], { cwd: state.normalized, timeout: 5000 });
      
      const lines = stdout.trim().split('\n').filter(line => line.length > 0);
      
      return {
        clean: lines.length === 0,
        modified: lines.filter(l => l.startsWith(' M')).length,
        added: lines.filter(l => l.startsWith('A ')).length,
        deleted: lines.filter(l => l.startsWith(' D')).length,
        untracked: lines.filter(l => l.startsWith('??')).length,
        total: lines.length
      };
      
    } catch (error) {
      logger.error('Failed to get git status', { 
        path: worktreePath, 
        error: error.message 
      });
      return null;
    }
  }
  
  async getRecentCommits(worktreePath, count = 5) {
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      return [];
    }
    
    try {
      const safeCount = Math.max(1, Math.min(Number(count) || 5, 50));
      const { stdout } = await this.execGit(['log', '--oneline', `-${safeCount}`], { cwd: state.normalized, timeout: 5000 });
      
      const commits = stdout.trim().split('\n').map(line => {
        const [hash, ...messageParts] = line.split(' ');
        return {
          hash,
          message: messageParts.join(' ')
        };
      });
      
      return commits;
      
    } catch (error) {
      logger.error('Failed to get recent commits', { 
        path: worktreePath, 
        error: error.message 
      });
      return [];
    }
  }
  
  async switchBranch(worktreePath, branchName) {
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      throw new Error(state.reason === 'invalid' ? 'Invalid worktree path' : 'Worktree path missing');
    }
    
    // Sanitize branch name
    if (!this.isValidBranchName(branchName)) {
      throw new Error('Invalid branch name');
    }
    
    try {
      await this.execGit(['checkout', branchName], { cwd: state.normalized, timeout: 10000 });
      
      // Clear cache for this path
      this.branchCache.delete(state.normalized);
      
      logger.info('Switched branch', { path: worktreePath, branch: branchName });
      return true;
      
    } catch (error) {
      logger.error('Failed to switch branch', { 
        path: worktreePath, 
        branch: branchName,
        error: error.message 
      });
      throw error;
    }
  }
  
  async getRemoteUrl(worktreePath) {
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      return null;
    }
    
    try {
      const { stdout } = await this.execGit(['remote', 'get-url', 'origin'], { cwd: state.normalized, timeout: GIT_COMMAND_TIMEOUT_MS });
      
      const remoteUrl = stdout.trim();
      
      // Convert SSH URL to HTTPS URL for GitHub
      let httpUrl = remoteUrl;
      if (remoteUrl.startsWith('git@github.com:')) {
        httpUrl = remoteUrl
          .replace('git@github.com:', 'https://github.com/')
          .replace(/\.git$/, '');
      } else if (remoteUrl.startsWith('https://')) {
        httpUrl = remoteUrl.replace(/\.git$/, '');
      }
      
      logger.info('Retrieved remote URL', { path: state.normalized, url: httpUrl });
      return httpUrl;
      
    } catch (error) {
      logger.error('Failed to get remote URL', { 
        path: state.normalized || worktreePath,
        error: error.message 
      });
      return null;
    }
  }

  async checkForExistingPR(remoteUrl, branch) {
    const cacheKey = `${remoteUrl || 'none'}|${branch || 'none'}`;
    const now = Date.now();
    const cached = this.prCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.prCacheTimeout) {
      return cached.value;
    }

    const storeCache = (value) => {
      this.prCache.set(cacheKey, { value, timestamp: Date.now() });
      return value;
    };

    // Only check for GitHub repositories
    if (!remoteUrl || !remoteUrl.includes('github.com') || !branch || branch === 'main' || branch === 'master' || branch.startsWith('detached@')) {
      return storeCache(null);
    }

    try {
      // Extract owner and repo from GitHub URL
      const urlMatch = remoteUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        return storeCache(null);
      }

      const [, owner, repo] = urlMatch;
      
      // Use GitHub CLI if available, otherwise use GitHub API directly
      try {
        const { stdout } = await this.execGh(
          ['pr', 'list', '--head', branch, '--json', 'url', '--jq', '.[0].url'],
          { timeout: GIT_LONG_COMMAND_TIMEOUT_MS, env: { GH_REPO: `${owner}/${repo}` } }
        );
        
        const prUrl = stdout.trim();
        if (prUrl && prUrl !== 'null' && prUrl.startsWith('https://github.com')) {
          logger.info('Found existing PR via gh CLI', { branch, prUrl });
          return storeCache(prUrl);
        }
      } catch (ghError) {
        logger.debug('gh CLI not available or failed, trying API directly', { error: ghError.message });
        
        // Fallback to direct GitHub API call without authentication
        const https = require('https');
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`;
        
        return new Promise((resolve) => {
          const req = https.get(apiUrl, {
            headers: {
              'User-Agent': 'claude-orchestrator',
              'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const prs = JSON.parse(data);
                if (Array.isArray(prs) && prs.length > 0) {
                  const prUrl = prs[0].html_url;
                  logger.info('Found existing PR via GitHub API', { branch, prUrl });
                  resolve(storeCache(prUrl));
                } else {
                  resolve(storeCache(null));
                }
              } catch (parseError) {
                logger.debug('Failed to parse GitHub API response', { error: parseError.message });
                resolve(storeCache(null));
              }
            });
          });
          
          req.on('error', (error) => {
            logger.debug('GitHub API request failed', { error: error.message, stack: error.stack });
            resolve(storeCache(null));
          });
          
          req.on('timeout', () => {
            logger.debug('GitHub API request timed out');
            req.destroy();
            resolve(storeCache(null));
          });
        });
      }
      
      return storeCache(null);
    } catch (error) {
      logger.debug('Failed to check for existing PR', { 
        branch, 
        remoteUrl, 
        error: error.message 
      });
      return storeCache(null);
    }
  }
  
  async getDefaultBranch(worktreePath) {
    const state = this.getPathState(worktreePath);
    if (!state.ok) {
      this.warnPathOnce(state.reason, worktreePath);
      return null;
    }
    
    try {
      // Try to get the default branch from remote
      const { stdout } = await this.execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: state.normalized, timeout: 5000 });
      
      // Extract branch name from refs/remotes/origin/main or refs/remotes/origin/master
      const defaultBranch = stdout.trim().replace('refs/remotes/origin/', '');
      logger.info('Retrieved default branch', { path: state.normalized, branch: defaultBranch });
      return defaultBranch;
      
    } catch (error) {
      // If that fails, try to check if main or master exists
      try {
        await this.execGit(['show-ref', '--verify', '--quiet', 'refs/heads/main'], { cwd: state.normalized, timeout: 5000 });
        return 'main';
      } catch {
        // Default to master if main doesn't exist
        return 'master';
      }
    }
  }
  
  isValidPath(worktreePath) {
    // Normalize path to prevent traversal attacks
    const normalized = path.resolve(worktreePath);

    // If a specific worktree pattern is configured, validate against it
    if (this.worktreePattern) {
      const pattern = new RegExp(this.worktreePattern);
      return pattern.test(normalized);
    }

    // Otherwise, allow known project roots. Default to HOME, but also allow common
    // dev roots used by this repo (e.g. legacy /games paths and /tmp test repos).
    const prefixes = [
      this.basePath,
      '/games',
      '/tmp'
    ];

    // WSL users often keep repos under /mnt/c/... which is outside HOME. Allow /mnt on WSL.
    try {
      const isWsl = !!process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release?.() || '');
      if (isWsl) prefixes.push('/mnt');
    } catch {
      // ignore
    }

    const resolvedPrefixes = prefixes.filter(Boolean).map((p) => path.resolve(p));

    return resolvedPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix + path.sep));
  }
  
  isValidBranchName(branchName) {
    // Basic validation for branch names
    const validPattern = /^[a-zA-Z0-9\-_\/]+$/;
    return validPattern.test(branchName) && 
           branchName.length < 100 &&
           !branchName.includes('..');
  }
  
  getCachedBranch(worktreePath) {
    const cached = this.branchCache.get(worktreePath);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTimeout) {
      this.branchCache.delete(worktreePath);
      return null;
    }
    
    return cached.branch;
  }
  
  setCachedBranch(worktreePath, branch) {
    this.branchCache.set(worktreePath, {
      branch,
      timestamp: Date.now()
    });
  }
  
  clearCache() {
    this.branchCache.clear();
    logger.info('Cleared branch cache');
  }
  
  clearCacheForPath(worktreePath) {
    const hadCache = this.branchCache.has(worktreePath);
    this.branchCache.delete(worktreePath);
    logger.info('🗑️ Cleared branch cache for path', { 
      path: worktreePath,
      hadCache,
      timestamp: new Date().toISOString()
    });
  }
  
  // Batch operation to update all branches
  async updateAllBranches(worktrees) {
    const updates = [];
    
    for (const worktree of worktrees) {
      updates.push(
        this.getCurrentBranch(worktree.path)
          .then(branch => ({ 
            worktreeId: worktree.id, 
            branch, 
            success: true 
          }))
          .catch(error => ({ 
            worktreeId: worktree.id, 
            branch: 'error', 
            success: false,
            error: error.message 
          }))
      );
    }
    
    const results = await Promise.all(updates);
    
    logger.info('Updated all branches', { 
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
    return results;
  }
}

module.exports = { GitHelper };
