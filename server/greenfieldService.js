const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const winston = require('winston');

const execAsync = util.promisify(exec);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/greenfield.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Project templates
const PROJECT_TEMPLATES = {
  'hytopia-game': {
    name: 'Hytopia Game',
    description: 'Hytopia SDK game project',
    initCommand: 'npx create-hytopia@latest',
    postInit: [],
    defaultPath: '~/GitHub/games/hytopia/games'
  },
  'node-typescript': {
    name: 'Node.js TypeScript',
    description: 'Node.js project with TypeScript',
    initCommand: null,
    files: {
      'package.json': `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^20.0.0"
  }
}`,
      'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}`,
      'src/index.ts': `console.log("Hello from {{projectName}}!");`,
      '.gitignore': `node_modules/
dist/
.env
*.log`
    },
    defaultPath: '~/GitHub/tools'
  },
  'empty': {
    name: 'Empty Project',
    description: 'Blank project with git initialization',
    initCommand: null,
    files: {
      'README.md': `# {{projectName}}\n\nProject description here.`,
      '.gitignore': `node_modules/\n.env\n*.log`
    },
    defaultPath: '~/GitHub'
  }
};

class GreenfieldService {
  constructor() {
    this.templates = PROJECT_TEMPLATES;
  }

  static getInstance() {
    if (!GreenfieldService.instance) {
      GreenfieldService.instance = new GreenfieldService();
    }
    return GreenfieldService.instance;
  }

  /**
   * Get all available project templates
   */
  getTemplates() {
    return Object.entries(this.templates).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      defaultPath: template.defaultPath
    }));
  }

  /**
   * Create a new greenfield project
   * @param {Object} options - Project options
   * @param {string} options.name - Project name
   * @param {string} options.template - Template ID
   * @param {string} options.path - Parent directory path
   * @param {boolean} options.initGit - Initialize git repository
   * @param {number} options.worktreeCount - Number of worktrees to create
   */
  async createProject(options) {
    const { name, template, path: parentPath, initGit = true, worktreeCount = 1 } = options;

    logger.info('Creating greenfield project', { name, template, parentPath });

    // Validate inputs
    if (!name || !name.match(/^[a-zA-Z0-9_-]+$/)) {
      throw new Error('Invalid project name. Use only letters, numbers, underscores, and hyphens.');
    }

    const templateConfig = this.templates[template];
    if (!templateConfig) {
      throw new Error(`Unknown template: ${template}`);
    }

    // Expand home directory
    const expandedPath = parentPath.replace('~', process.env.HOME);
    const projectPath = path.join(expandedPath, name);

    // Check if directory exists
    if (fsSync.existsSync(projectPath)) {
      throw new Error(`Directory already exists: ${projectPath}`);
    }

    try {
      // Create project directory
      await fs.mkdir(projectPath, { recursive: true });
      logger.info('Created project directory', { projectPath });

      // Initialize project based on template
      if (templateConfig.initCommand) {
        // Run init command (like npx create-hytopia)
        await this.runInitCommand(templateConfig.initCommand, name, expandedPath);
      } else if (templateConfig.files) {
        // Create files from template
        await this.createFilesFromTemplate(projectPath, name, templateConfig.files);
      }

      // Initialize git if requested
      if (initGit) {
        await this.initializeGit(projectPath);
      }

      // Create worktrees if requested and git is initialized
      const worktrees = [];
      if (initGit && worktreeCount > 0) {
        // First create master directory and move files there
        const masterPath = path.join(projectPath, 'master');
        await this.convertToWorktreeStructure(projectPath, masterPath);

        worktrees.push({ id: 'master', path: masterPath });

        // Create additional worktrees
        for (let i = 1; i <= worktreeCount; i++) {
          const worktreePath = path.join(projectPath, `work${i}`);
          await this.createWorktree(masterPath, worktreePath, `work${i}`);
          worktrees.push({ id: `work${i}`, path: worktreePath });
        }
      }

      logger.info('Greenfield project created successfully', { projectPath, worktrees: worktrees.length });

      return {
        success: true,
        projectPath,
        masterPath: worktrees.length > 0 ? worktrees[0].path : projectPath,
        worktrees,
        template: templateConfig.name
      };
    } catch (error) {
      // Clean up on failure
      logger.error('Failed to create project, cleaning up', { error: error.message });
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn('Failed to clean up project directory', { cleanupError: cleanupError.message });
      }
      throw error;
    }
  }

  async runInitCommand(command, projectName, workingDir) {
    logger.info('Running init command', { command, projectName, workingDir });

    try {
      const { stdout, stderr } = await execAsync(`${command} ${projectName}`, {
        cwd: workingDir,
        timeout: 120000 // 2 minute timeout
      });

      if (stderr) {
        logger.warn('Init command stderr', { stderr });
      }

      logger.info('Init command completed', { stdout: stdout.slice(0, 200) });
    } catch (error) {
      throw new Error(`Init command failed: ${error.message}`);
    }
  }

  async createFilesFromTemplate(projectPath, projectName, files) {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(projectPath, relativePath);
      const dirPath = path.dirname(filePath);

      // Create directory if needed
      await fs.mkdir(dirPath, { recursive: true });

      // Replace placeholders
      const processedContent = content.replace(/\{\{projectName\}\}/g, projectName);

      await fs.writeFile(filePath, processedContent);
      logger.debug('Created file', { filePath });
    }
  }

  async initializeGit(projectPath) {
    logger.info('Initializing git repository', { projectPath });

    await execAsync('git init', { cwd: projectPath });
    await execAsync('git add .', { cwd: projectPath });
    await execAsync('git commit -m "Initial commit"', { cwd: projectPath });

    logger.info('Git repository initialized');
  }

  async convertToWorktreeStructure(projectPath, masterPath) {
    // Create master directory
    await fs.mkdir(masterPath, { recursive: true });

    // Move all files to master (except .git)
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'master') continue;

      const srcPath = path.join(projectPath, entry.name);
      const destPath = path.join(masterPath, entry.name);

      await fs.rename(srcPath, destPath);
    }

    // Move .git to master
    const gitSrc = path.join(projectPath, '.git');
    const gitDest = path.join(masterPath, '.git');
    await fs.rename(gitSrc, gitDest);

    logger.info('Converted to worktree structure', { masterPath });
  }

  async createWorktree(masterPath, worktreePath, branchName) {
    logger.info('Creating worktree', { masterPath, worktreePath, branchName });

    // Create branch and worktree
    try {
      // Create branch from current HEAD
      await execAsync(`git branch ${branchName}`, { cwd: masterPath });
    } catch (error) {
      // Branch might already exist
      logger.debug('Branch might already exist', { branchName });
    }

    // Create worktree
    await execAsync(`git worktree add "${worktreePath}" ${branchName}`, { cwd: masterPath });

    logger.info('Worktree created', { worktreePath, branchName });
  }

  /**
   * Validate a project path
   */
  async validatePath(projectPath) {
    const expandedPath = projectPath.replace('~', process.env.HOME);

    try {
      const stats = await fs.stat(expandedPath);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
        path: expandedPath
      };
    } catch (error) {
      return {
        exists: false,
        isDirectory: false,
        path: expandedPath
      };
    }
  }
}

module.exports = { GreenfieldService };
