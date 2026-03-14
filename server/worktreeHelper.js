const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/worktree.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class WorktreeHelper {
  constructor() {}

  async resolvePreferredBaseBranch(masterPath, preferredBranch = 'master') {
    const preferred = String(preferredBranch || '').trim() || 'master';
    const candidates = preferred === 'master'
      ? ['master', 'main']
      : [preferred, 'master', 'main'];

    for (const branch of candidates) {
      try {
        await this.executeGitCommand(`git rev-parse --verify ${branch}`, masterPath);
        return branch;
      } catch (error) {
        // Try next candidate
      }
    }

    throw new Error(`No usable base branch found (${candidates.join(', ')})`);
  }

  async createProjectWorktrees({ projectPath, count = 0, baseBranch = 'master' } = {}) {
    const root = String(projectPath || '').trim();
    if (!root) throw new Error('projectPath is required');

    const total = Math.max(0, Number(count) || 0);
    if (total === 0) return [];

    const masterPath = path.join(root, 'master');
    await fs.access(masterPath);

    const resolvedBaseBranch = await this.resolvePreferredBaseBranch(masterPath, baseBranch);
    const created = [];

    for (let i = 1; i <= total; i += 1) {
      const worktreeId = `work${i}`;
      const worktreePath = path.join(root, worktreeId);
      await this.executeGitCommand(`git worktree add -B ${worktreeId} ../${worktreeId} ${resolvedBaseBranch}`, masterPath);
      created.push({ id: worktreeId, path: worktreePath });
    }

    return created;
  }

  async createWorktree(workspace, worktreeId) {
    logger.info(`Creating worktree ${worktreeId} for workspace ${workspace.name}`);

    const { repository, worktrees: worktreeConfig } = workspace;
    const worktreeName = worktreeConfig.namingPattern.replace('{n}', worktreeId.replace('work', ''));
    const worktreePath = path.join(repository.path, worktreeName);
    const masterPath = path.join(repository.path, 'master');

    try {
      // Check if worktree already exists
      try {
        await fs.access(worktreePath);
        logger.info(`Worktree ${worktreeId} already exists at ${worktreePath}`);
        return worktreePath;
      } catch (error) {
        // Worktree doesn't exist, create it
      }

      // Check if master directory exists
      try {
        await fs.access(masterPath);
      } catch (error) {
        throw new Error(`Master directory not found: ${masterPath}. Cannot create worktree.`);
      }

      // Auto-detect the actual default branch
      let defaultBranch = repository.masterBranch;
      try {
        // Check if specified branch exists
        await this.executeGitCommand(`git rev-parse --verify ${defaultBranch}`, masterPath);
        logger.info(`Using specified branch: ${defaultBranch}`);
      } catch (error) {
        // Try main if master fails
        if (defaultBranch === 'master') {
          try {
            await this.executeGitCommand(`git rev-parse --verify main`, masterPath);
            defaultBranch = 'main';
            logger.info(`Master not found, using main branch instead`);
          } catch (error2) {
            throw new Error(`Neither master nor main branch found in repository`);
          }
        } else {
          throw new Error(`Branch ${defaultBranch} not found in repository`);
        }
      }

      // Create worktree using detected branch
      const branchName = `${worktreeName}-dev`;

      // Check if branch already exists and delete it if needed
      try {
        await this.executeGitCommand(`git branch -D ${branchName}`, masterPath);
        logger.info(`Deleted existing branch: ${branchName}`);
      } catch (error) {
        // Branch doesn't exist, that's fine
        logger.debug(`Branch ${branchName} doesn't exist (expected)`);
      }

      const command = `git worktree add ../${worktreeName} -b ${branchName} ${defaultBranch}`;
      logger.info(`Executing: ${command}`, { cwd: masterPath });

      await this.executeGitCommand(command, masterPath);

      // Verify worktree was created
      await fs.access(worktreePath);
      logger.info(`Successfully created worktree: ${worktreePath}`);

      return worktreePath;
    } catch (error) {
      logger.error(`Failed to create worktree ${worktreeId}`, {
        error: error.message,
        workspace: workspace.name,
        path: worktreePath
      });
      throw error;
    }
  }

  async removeWorktree(workspace, worktreeId) {
    logger.info(`Removing worktree ${worktreeId} for workspace ${workspace.name}`);

    const { repository, worktrees: worktreeConfig } = workspace;
    const worktreeName = worktreeConfig.namingPattern.replace('{n}', worktreeId.replace('work', ''));
    const worktreePath = path.join(repository.path, worktreeName);
    const masterPath = path.join(repository.path, 'master');

    try {
      // Check if worktree exists
      try {
        await fs.access(worktreePath);
      } catch (error) {
        logger.info(`Worktree ${worktreeId} doesn't exist, nothing to remove`);
        return;
      }

      // Remove worktree using git worktree remove
      const command = `git worktree remove ${worktreeName}`;
      logger.info(`Executing: ${command}`, { cwd: masterPath });

      await this.executeGitCommand(command, masterPath);

      logger.info(`Successfully removed worktree: ${worktreePath}`);
    } catch (error) {
      logger.error(`Failed to remove worktree ${worktreeId}`, {
        error: error.message,
        workspace: workspace.name,
        path: worktreePath
      });
      throw error;
    }
  }

  async listWorktrees(workspace) {
    const { repository } = workspace;
    const masterPath = path.join(repository.path, 'master');

    try {
      const command = 'git worktree list';
      const output = await this.executeGitCommand(command, masterPath);

      const worktrees = output.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            path: parts[0],
            branch: parts[1] ? parts[1].replace(/[[\]]/g, '') : 'unknown'
          };
        });

      logger.info(`Found ${worktrees.length} worktrees`, { workspace: workspace.name });
      return worktrees;
    } catch (error) {
      logger.error(`Failed to list worktrees`, {
        error: error.message,
        workspace: workspace.name
      });
      throw error;
    }
  }

  async ensureWorktreesExist(workspace) {
    if (!workspace.repository || !workspace.repository.path) {
      logger.info('Workspace has no repository path, skipping worktree creation', {
        workspace: workspace.name
      });
      return [];
    }

    if (!workspace.worktrees.enabled) {
      logger.info(`Worktrees disabled for workspace ${workspace.name}, skipping creation`);
      return [];
    }

    logger.info(`Ensuring worktrees exist for workspace ${workspace.name}`, {
      count: workspace.terminals.pairs,
      autoCreate: workspace.worktrees.autoCreate
    });

    const requiredWorktrees = [];
    const createdWorktrees = [];

    // Determine which worktrees are needed
    for (let i = 1; i <= workspace.terminals.pairs; i++) {
      const worktreeId = `work${i}`;
      const worktreeName = workspace.worktrees.namingPattern.replace('{n}', i);
      const worktreePath = path.join(workspace.repository.path, worktreeName);

      requiredWorktrees.push({ id: worktreeId, name: worktreeName, path: worktreePath });
    }

    // Check which worktrees exist
    for (const worktree of requiredWorktrees) {
      try {
        await fs.access(worktree.path);
        logger.debug(`Worktree exists: ${worktree.path}`);
      } catch (error) {
        // Worktree doesn't exist
        if (workspace.worktrees.autoCreate) {
          logger.info(`Auto-creating missing worktree: ${worktree.id}`);
          try {
            await this.createWorktree(workspace, worktree.id);
            createdWorktrees.push(worktree.id);
          } catch (createError) {
            logger.error(`Failed to auto-create worktree ${worktree.id}`, { error: createError.message });
          }
        } else {
          logger.warn(`Worktree ${worktree.id} doesn't exist and auto-create is disabled`, {
            path: worktree.path,
            workspace: workspace.name
          });
        }
      }
    }

    if (createdWorktrees.length > 0) {
      logger.info(`Created ${createdWorktrees.length} worktrees`, {
        workspace: workspace.name,
        created: createdWorktrees
      });
    }

    return createdWorktrees;
  }

  executeGitCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const child = spawn(cmd, args, {
        ...getHiddenProcessOptions({
          cwd,
          stdio: 'pipe',
          env: augmentProcessEnv(process.env)
        })
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Git command failed: ${command}\nExit code: ${code}\nStderr: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute git command: ${command}\nError: ${error.message}`));
      });
    });
  }
}

module.exports = { WorktreeHelper };
