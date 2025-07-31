const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const winston = require('winston');

const execAsync = util.promisify(exec);

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

class GitHelper {
  constructor() {
    // Cache branch names to reduce git calls
    this.branchCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
    
    // Valid worktree paths for security
    this.validPaths = new Set();
    const basePath = process.env.WORKTREE_BASE_PATH || process.env.HOME || '/home/ab';
    const worktreeCount = parseInt(process.env.WORKTREE_COUNT || '8');
    
    for (let i = 1; i <= worktreeCount; i++) {
      this.validPaths.add(`${basePath}/HyFire2-work${i}`);
    }
  }
  
  async getCurrentBranch(worktreePath) {
    // Security: Validate path to prevent directory traversal
    if (!this.isValidPath(worktreePath)) {
      logger.error('Invalid worktree path attempted', { path: worktreePath });
      throw new Error('Invalid worktree path');
    }
    
    // Check cache first
    const cached = this.getCachedBranch(worktreePath);
    if (cached) {
      logger.debug('Using cached branch', { path: worktreePath, branch: cached });
      return cached;
    }
    
    try {
      // Use git to get current branch
      const { stdout, stderr } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
        timeout: 5000, // 5 second timeout
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1', // Ignore system git config for security
          HOME: worktreePath // Limit git config search
        }
      });
      
      if (stderr) {
        logger.warn('Git command produced stderr', { 
          path: worktreePath, 
          stderr: stderr.trim() 
        });
      }
      
      const branch = stdout.trim();
      
      // Handle detached HEAD state
      if (branch === 'HEAD') {
        // Try to get commit hash instead
        const { stdout: commitHash } = await execAsync('git rev-parse --short HEAD', {
          cwd: worktreePath,
          timeout: 5000
        });
        
        const shortHash = commitHash.trim();
        this.setCachedBranch(worktreePath, `detached@${shortHash}`);
        return `detached@${shortHash}`;
      }
      
      // Cache the result
      this.setCachedBranch(worktreePath, branch);
      
      logger.info('Retrieved git branch', { path: worktreePath, branch });
      return branch;
      
    } catch (error) {
      logger.error('Failed to get git branch', { 
        path: worktreePath, 
        error: error.message 
      });
      
      // Check if it's not a git repository
      if (error.message.includes('not a git repository')) {
        return 'no-git';
      }
      
      return 'unknown';
    }
  }
  
  async getStatus(worktreePath) {
    if (!this.isValidPath(worktreePath)) {
      throw new Error('Invalid worktree path');
    }
    
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: worktreePath,
        timeout: 5000
      });
      
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
    if (!this.isValidPath(worktreePath)) {
      throw new Error('Invalid worktree path');
    }
    
    try {
      const { stdout } = await execAsync(
        `git log --oneline -${count}`,
        {
          cwd: worktreePath,
          timeout: 5000
        }
      );
      
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
    if (!this.isValidPath(worktreePath)) {
      throw new Error('Invalid worktree path');
    }
    
    // Sanitize branch name
    if (!this.isValidBranchName(branchName)) {
      throw new Error('Invalid branch name');
    }
    
    try {
      await execAsync(`git checkout ${branchName}`, {
        cwd: worktreePath,
        timeout: 10000
      });
      
      // Clear cache for this path
      this.branchCache.delete(worktreePath);
      
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
  
  isValidPath(worktreePath) {
    // Normalize path to prevent traversal attacks
    const normalized = path.normalize(worktreePath);
    return this.validPaths.has(normalized);
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