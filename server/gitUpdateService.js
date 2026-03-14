const { execFile } = require('child_process');
const { promisify } = require('util');
const winston = require('winston');
const path = require('path');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/git-update.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class GitUpdateService {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
  }

  static isPullableBranchName(branchName) {
    const name = String(branchName || '').trim();
    if (!name) return false;
    const lower = name.toLowerCase();
    const blocked = new Set(['head', 'unknown', 'no-git', 'missing', 'invalid-path']);
    if (blocked.has(lower)) return false;
    if (name.includes('..') || name.includes('@{') || name.endsWith('.') || name.endsWith('/') || name.startsWith('-')) {
      return false;
    }
    if (/[\s\\~^:?*\[\]\x00-\x1f]/.test(name)) return false;
    return true;
  }

  async execGit(args, { timeoutMs = 20000 } = {}) {
    const argv = Array.isArray(args) ? args.map(String) : [];
    if (!argv.length) throw new Error('execGit: args required');
    const { stdout, stderr } = await execFileAsync('git', argv, {
      ...getHiddenProcessOptions({
        cwd: this.projectRoot,
        timeout: timeoutMs,
        env: augmentProcessEnv(process.env)
      }),
      maxBuffer: DEFAULT_MAX_BUFFER
    });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
  }

  static getInstance() {
    if (!GitUpdateService.instance) {
      GitUpdateService.instance = new GitUpdateService();
    }
    return GitUpdateService.instance;
  }

  async getCurrentBranch() {
    try {
      const { stdout } = await this.execGit(['branch', '--show-current'], { timeoutMs: 10000 });
      return stdout.trim();
    } catch (error) {
      logger.error('Failed to get current branch', { error: error.message });
      throw error;
    }
  }

  async getStatus() {
    try {
      const { stdout } = await this.execGit(['status', '--porcelain'], { timeoutMs: 15000 });
      const hasChanges = stdout.trim().length > 0;
      return {
        hasChanges,
        changes: stdout.trim().split('\n').filter(line => line.trim())
      };
    } catch (error) {
      logger.error('Failed to get git status', { error: error.message });
      throw error;
    }
  }

  async fetchLatest() {
    try {
      const { stdout, stderr } = await this.execGit(['fetch', 'origin'], { timeoutMs: 30000 });
      logger.info('Fetched latest changes from origin');
      return { stdout, stderr };
    } catch (error) {
      logger.error('Failed to fetch latest changes', { error: error.message });
      throw error;
    }
  }

  async pullLatest() {
    try {
      // Check current branch
      const currentBranch = String(await this.getCurrentBranch() || '').trim();
      if (!GitUpdateService.isPullableBranchName(currentBranch)) {
        logger.warn('Cannot pull - invalid or detached branch', { currentBranch });
        return {
          success: false,
          error: `Cannot pull from current branch '${currentBranch || '(empty)'}'. Switch to a named branch first.`,
          currentBranch
        };
      }
      
      // Check for uncommitted changes
      const status = await this.getStatus();
      
      if (status.hasChanges) {
        logger.warn('Cannot pull - uncommitted changes detected', { changes: status.changes });
        return {
          success: false,
          error: 'Uncommitted changes detected. Please commit or stash your changes first.',
          changes: status.changes
        };
      }

      // If not on main/master, warn but continue
      const isOnMainBranch = currentBranch === 'main' || currentBranch === 'master';
      if (!isOnMainBranch) {
        logger.warn('Not on main branch, pulling current branch', { 
          currentBranch,
          recommendation: 'Consider switching to main/master for updates'
        });
      }

      // Fetch first
      await this.fetchLatest();

      // Pull current branch (use different strategy based on branch)
      const pullArgs = ['pull', 'origin', currentBranch];
      
      // For feature branches, try to pull from remote, but if it fails, suggest using main/master
      if (!isOnMainBranch) {
        // First check if the remote branch exists
        try {
          const { stdout: remoteStdout } = await this.execGit(['ls-remote', '--heads', 'origin', currentBranch], { timeoutMs: 15000 });
          const remoteBranchExists = remoteStdout.trim().length > 0;

          if (!remoteBranchExists) {
            return {
              success: false,
              error: `Branch '${currentBranch}' doesn't exist on remote. Consider switching to main/master for updates, or push your feature branch first.`,
              currentBranch,
              suggestion: 'Switch to main branch for updates'
            };
          }

          const { stdout, stderr } = await this.execGit(pullArgs, { timeoutMs: 60000 });
          logger.info('Successfully pulled latest changes', { currentBranch, output: stdout });
          return {
            success: true,
            currentBranch,
            output: stdout,
            stderr,
            wasUpToDate: stdout.includes('Already up to date') || stdout.includes('Already up-to-date')
          };
        } catch (error) {
          logger.error('Failed to pull latest changes', { error: error.message, currentBranch });
          return {
            success: false,
            error: `Failed to pull ${currentBranch}: ${error.message}`,
            currentBranch,
            suggestion: 'Try switching to main/master branch'
          };
        }
      }
      
      // For main/master branches, proceed normally
      try {
        const { stdout, stderr } = await this.execGit(pullArgs, { timeoutMs: 60000 });
        logger.info('Successfully pulled latest changes', { currentBranch, output: stdout });
        return {
          success: true,
          currentBranch,
          output: stdout,
          stderr,
          wasUpToDate: stdout.includes('Already up to date') || stdout.includes('Already up-to-date')
        };
      } catch (error) {
        logger.error('Failed to pull latest changes', { error: error.message, currentBranch });
        return {
          success: false,
          error: error.message,
          currentBranch
        };
      }

    } catch (error) {
      logger.error('Error during pull operation', { error: error.message, stack: error.stack });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async checkForUpdates() {
    try {
      const currentBranch = String(await this.getCurrentBranch() || '').trim();
      if (!GitUpdateService.isPullableBranchName(currentBranch)) {
        return {
          hasUpdates: null,
          currentBranch,
          error: `Cannot check updates for branch '${currentBranch || '(empty)'}'`
        };
      }
      
      // Fetch latest
      await this.fetchLatest();

      // Check if behind origin
      try {
        const { stdout, stderr } = await this.execGit(['rev-list', '--count', `HEAD..origin/${currentBranch}`], { timeoutMs: 15000 });
        const commitsBehind = parseInt(String(stdout || '').trim(), 10) || 0;
        return {
          hasUpdates: commitsBehind > 0,
          commitsBehind,
          currentBranch,
          stderr
        };
      } catch (error) {
        logger.error('Failed to check for updates', { error: error.message });
        return {
          hasUpdates: null,
          error: error.message
        };
      }

    } catch (error) {
      logger.error('Error checking for updates', { error: error.message, stack: error.stack });
      return {
        hasUpdates: null,
        error: error.message
      };
    }
  }
}

module.exports = { GitUpdateService };
