const { exec } = require('child_process');
const winston = require('winston');
const path = require('path');

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

  static getInstance() {
    if (!GitUpdateService.instance) {
      GitUpdateService.instance = new GitUpdateService();
    }
    return GitUpdateService.instance;
  }

  async getCurrentBranch() {
    return new Promise((resolve, reject) => {
      exec('git branch --show-current', { cwd: this.projectRoot }, (error, stdout, stderr) => {
        if (error) {
          logger.error('Failed to get current branch', { error: error.message, stderr });
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async getStatus() {
    return new Promise((resolve, reject) => {
      exec('git status --porcelain', { cwd: this.projectRoot }, (error, stdout, stderr) => {
        if (error) {
          logger.error('Failed to get git status', { error: error.message, stderr });
          reject(error);
          return;
        }
        
        const hasChanges = stdout.trim().length > 0;
        resolve({
          hasChanges,
          changes: stdout.trim().split('\n').filter(line => line.trim())
        });
      });
    });
  }

  async fetchLatest() {
    return new Promise((resolve, reject) => {
      exec('git fetch origin', { cwd: this.projectRoot }, (error, stdout, stderr) => {
        if (error) {
          logger.error('Failed to fetch latest changes', { error: error.message, stderr });
          reject(error);
          return;
        }
        logger.info('Fetched latest changes from origin');
        resolve({ stdout, stderr });
      });
    });
  }

  async pullLatest() {
    try {
      // Check current branch
      const currentBranch = await this.getCurrentBranch();
      
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
      let pullCommand = `git pull origin ${currentBranch}`;
      
      // For feature branches, try to pull from remote, but if it fails, suggest using main/master
      if (!isOnMainBranch) {
        // First check if the remote branch exists
        return new Promise((resolve) => {
          exec(`git ls-remote --heads origin ${currentBranch}`, { cwd: this.projectRoot }, (error, stdout) => {
            const remoteBranchExists = stdout.trim().length > 0;
            
            if (!remoteBranchExists) {
              // Feature branch doesn't exist on remote, suggest main/master
              resolve({
                success: false,
                error: `Branch '${currentBranch}' doesn't exist on remote. Consider switching to main/master for updates, or push your feature branch first.`,
                currentBranch,
                suggestion: 'Switch to main branch for updates'
              });
              return;
            }
            
            // Remote branch exists, proceed with normal pull
            exec(pullCommand, { cwd: this.projectRoot }, (error, stdout, stderr) => {
              if (error) {
                logger.error('Failed to pull latest changes', { 
                  error: error.message, 
                  stderr,
                  currentBranch 
                });
                resolve({
                  success: false,
                  error: `Failed to pull ${currentBranch}: ${error.message}`,
                  stderr,
                  currentBranch,
                  suggestion: 'Try switching to main/master branch'
                });
                return;
              }
              
              logger.info('Successfully pulled latest changes', { 
                currentBranch,
                output: stdout 
              });

              resolve({
                success: true,
                currentBranch,
                output: stdout,
                wasUpToDate: stdout.includes('Already up to date') || stdout.includes('Already up-to-date')
              });
            });
          });
        });
      }
      
      // For main/master branches, proceed normally
      return new Promise((resolve) => {
        exec(pullCommand, { cwd: this.projectRoot }, (error, stdout, stderr) => {
          if (error) {
            logger.error('Failed to pull latest changes', { 
              error: error.message, 
              stderr,
              currentBranch 
            });
            resolve({
              success: false,
              error: error.message,
              stderr,
              currentBranch
            });
            return;
          }

          logger.info('Successfully pulled latest changes', { 
            currentBranch,
            output: stdout 
          });

          resolve({
            success: true,
            currentBranch,
            output: stdout,
            wasUpToDate: stdout.includes('Already up to date') || stdout.includes('Already up-to-date')
          });
        });
      });

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
      const currentBranch = await this.getCurrentBranch();
      
      // Fetch latest
      await this.fetchLatest();

      // Check if behind origin
      return new Promise((resolve) => {
        exec(`git rev-list --count HEAD..origin/${currentBranch}`, { cwd: this.projectRoot }, (error, stdout, stderr) => {
          if (error) {
            logger.error('Failed to check for updates', { error: error.message, stderr });
            resolve({
              hasUpdates: null,
              error: error.message
            });
            return;
          }

          const commitsBehind = parseInt(stdout.trim()) || 0;
          resolve({
            hasUpdates: commitsBehind > 0,
            commitsBehind,
            currentBranch
          });
        });
      });

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