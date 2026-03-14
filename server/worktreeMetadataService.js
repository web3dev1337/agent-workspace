/**
 * WorktreeMetadataService - Enhanced metadata for worktrees
 *
 * Provides:
 * - Uncommitted files count and status
 * - PR status (open/closed/merged) from GitHub
 * - Branch info
 * - Caching with periodic refresh
 */

const { execFile } = require('child_process');
const util = require('util');
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
    new winston.transports.File({ filename: 'logs/worktree-metadata.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class WorktreeMetadataService {
  constructor() {
    this.cache = new Map();
    this.cacheMaxAge = 60 * 1000; // 1 minute for git status
    this.prCacheMaxAge = 5 * 60 * 1000; // 5 minutes for PR status
  }

  static getInstance() {
    if (!WorktreeMetadataService.instance) {
      WorktreeMetadataService.instance = new WorktreeMetadataService();
    }
    return WorktreeMetadataService.instance;
  }

  /**
   * Get full metadata for a worktree
   */
  async getMetadata(worktreePath) {
    const [gitStatus, prStatus] = await Promise.all([
      this.getGitStatus(worktreePath),
      this.getPRStatus(worktreePath)
    ]);

    return {
      path: worktreePath,
      git: gitStatus,
      pr: prStatus,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get git status for a worktree
   */
  async getGitStatus(worktreePath) {
    const cacheKey = `git:${worktreePath}`;
    const cached = this.getFromCache(cacheKey, this.cacheMaxAge);
    if (cached) return cached;

    try {
      // Get branch name
      const { stdout: branchOutput } = await execFileSafe(
        'git',
        ['branch', '--show-current'],
        { cwd: worktreePath, timeout: 5000 }
      );
      const branch = branchOutput.trim();

      // Get status (modified, untracked, staged)
      const { stdout: statusOutput } = await execFileSafe(
        'git',
        ['status', '--porcelain'],
        { cwd: worktreePath, timeout: 5000 }
      );

      const lines = statusOutput.trim().split('\n').filter(l => l);
      const modified = lines.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
      const untracked = lines.filter(l => l.startsWith('??')).length;
      const staged = lines.filter(l => l.startsWith('A ') || l.startsWith('M ') || l.startsWith('D ')).length;
      const deleted = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).length;

      // Get ahead/behind from remote
      let ahead = 0;
      let behind = 0;
      try {
        const { stdout: trackingOutput } = await execFileSafe(
          'git',
          ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
          { cwd: worktreePath, timeout: 5000 }
        );
        const [b, a] = trackingOutput.trim().split('\t').map(Number);
        behind = b || 0;
        ahead = a || 0;
      } catch (e) {
        // No upstream configured
      }

      // Get last commit info
      let lastCommit = null;
      try {
        const { stdout: commitOutput } = await execFileSafe(
          'git',
          ['log', '-1', '--format=%h|%s|%ar'],
          { cwd: worktreePath, timeout: 5000 }
        );
        const [hash, message, timeAgo] = commitOutput.trim().split('|');
        lastCommit = { hash, message, timeAgo };
      } catch (e) {
        // No commits
      }

      const result = {
        branch,
        modified,
        untracked,
        staged,
        deleted,
        total: lines.length,
        ahead,
        behind,
        hasUncommittedChanges: lines.length > 0,
        lastCommit
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (error) {
      logger.debug('Failed to get git status', { path: worktreePath, error: error.message });
      return {
        branch: null,
        modified: 0,
        untracked: 0,
        staged: 0,
        deleted: 0,
        total: 0,
        ahead: 0,
        behind: 0,
        hasUncommittedChanges: false,
        lastCommit: null,
        error: error.message
      };
    }
  }

  /**
   * Get PR status for a branch using GitHub CLI
   */
  async getPRStatus(worktreePath) {
    const cacheKey = `pr:${worktreePath}`;
    const cached = this.getFromCache(cacheKey, this.prCacheMaxAge);
    if (cached) return cached;

    let branch = null;
    try {
      // Get current branch
      const { stdout: branchOutput } = await execFileSafe(
        'git',
        ['branch', '--show-current'],
        { cwd: worktreePath, timeout: 5000 }
      );
      branch = branchOutput.trim();

      if (!branch || branch === 'main' || branch === 'master') {
        return { hasPR: false, branch };
      }

      // Check for PR on this branch
      const { stdout: prOutput } = await execFileSafe(
        'gh',
        ['pr', 'list', '--head', branch, '--json', 'number,title,state,url,isDraft,mergeable', '--limit', '1'],
        { cwd: worktreePath, timeout: 10000 }
      );

      const prs = JSON.parse(prOutput);

      if (prs.length === 0) {
        const result = { hasPR: false, branch };
        this.setCache(cacheKey, result);
        return result;
      }

      const pr = prs[0];
      const result = {
        hasPR: true,
        branch,
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase(), // OPEN, CLOSED, MERGED
        url: pr.url,
        isDraft: pr.isDraft,
        mergeable: pr.mergeable
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (error) {
      logger.debug('Failed to get PR status', { path: worktreePath, error: error.message });
      return {
        hasPR: false,
        branch,
        error: error.message
      };
    }
  }

  /**
   * Get metadata for multiple worktrees in parallel
   */
  async getMultipleMetadata(worktreePaths) {
    const results = await Promise.all(
      worktreePaths.map(path => this.getMetadata(path))
    );

    return results.reduce((acc, result, index) => {
      acc[worktreePaths[index]] = result;
      return acc;
    }, {});
  }

  /**
   * Refresh cache for a worktree
   */
  async refresh(worktreePath) {
    this.cache.delete(`git:${worktreePath}`);
    this.cache.delete(`pr:${worktreePath}`);
    return await this.getMetadata(worktreePath);
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get from cache if not expired
   */
  getFromCache(key, maxAge) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cache entry
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}

module.exports = { WorktreeMetadataService };
