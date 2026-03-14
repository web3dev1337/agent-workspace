const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const util = require('util');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const execAsyncBase = util.promisify(exec);
async function execAsync(command, options = {}) {
  return execAsyncBase(command, {
    ...getHiddenProcessOptions(options),
    env: augmentProcessEnv(options.env || process.env)
  });
}

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

// Project categories - determines folder structure
function expandUserPath(p) {
  const raw = String(p || '').trim();
  if (!raw) return raw;

  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function resolveGitHubRoot() {
  const envRoot = process.env.GREENFIELD_GITHUB_ROOT || process.env.GITHUB_ROOT || '';
  const root = envRoot ? expandUserPath(envRoot) : path.join(os.homedir(), 'GitHub');
  return root;
}

function joinGitHubRoot(...parts) {
  return path.join(resolveGitHubRoot(), ...parts);
}

const PROJECT_CATEGORIES = {
  'website': {
    path: joinGitHubRoot('websites'),
    keywords: ['website', 'web app', 'frontend', 'landing page', 'portfolio', 'blog']
  },
  'game': {
    path: joinGitHubRoot('games'),
    keywords: ['game', 'hytopia', 'unity', 'godot', 'gaming']
  },
  'tool': {
    path: joinGitHubRoot('tools'),
    keywords: ['tool', 'cli', 'utility', 'automation', 'script']
  },
  'api': {
    path: joinGitHubRoot('apis'),
    keywords: ['api', 'backend', 'server', 'service', 'rest', 'graphql']
  },
  'library': {
    path: joinGitHubRoot('libraries'),
    keywords: ['library', 'package', 'module', 'npm', 'sdk']
  },
  'other': {
    path: joinGitHubRoot('projects'),
    keywords: []
  }
};

// Project templates
const PROJECT_TEMPLATES = {
  'hytopia-game': {
    name: 'Hytopia Game',
    description: 'Hytopia SDK game project',
    initCommand: 'npx create-hytopia@latest',
    postInit: [],
    defaultPath: joinGitHubRoot('games', 'hytopia', 'games')
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
    defaultPath: joinGitHubRoot('tools')
  },
  'empty': {
    name: 'Empty Project',
    description: 'Blank project with git initialization',
    initCommand: null,
    files: {
      'README.md': `# {{projectName}}\n\nProject description here.`,
      '.gitignore': `node_modules/\n.env\n*.log`
    },
    defaultPath: resolveGitHubRoot()
  }
};

class GreenfieldService {
  constructor() {
    this.templates = PROJECT_TEMPLATES;
    this.categories = PROJECT_CATEGORIES;
    this.sessionManager = null; // Set via setSessionManager()
    this.io = null; // Set via setIO()
    this.projectTypeService = null;
  }

  static getInstance() {
    if (!GreenfieldService.instance) {
      GreenfieldService.instance = new GreenfieldService();
    }
    return GreenfieldService.instance;
  }

  normalizeRepoUrl(url) {
    if (!url) return null;
    let cleaned = String(url).trim().split(/\s+/)[0];

    if (cleaned.startsWith('git@')) {
      cleaned = cleaned.replace(/^git@([^:]+):/, 'https://$1/');
    } else if (cleaned.startsWith('ssh://git@')) {
      cleaned = cleaned.replace(/^ssh:\/\/git@/, 'https://');
    }

    if (cleaned.endsWith('.git')) {
      cleaned = cleaned.slice(0, -4);
    }

    return cleaned;
  }

  async getRemoteRepoUrl(cwd) {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd });
      return this.normalizeRepoUrl(stdout);
    } catch (error) {
      return null;
    }
  }

  setSessionManager(sessionManager) {
    this.sessionManager = sessionManager;
  }

  setIO(io) {
    this.io = io;
  }

  setProjectTypeService(projectTypeService) {
    this.projectTypeService = projectTypeService || null;
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
   * Get all project categories
   */
  getCategories() {
    if (this.projectTypeService && typeof this.projectTypeService.getCategories === 'function') {
      return this.projectTypeService.getCategories().map((cat) => ({
        id: cat.id,
        path: cat.basePathResolved || cat.basePath || '',
        keywords: Array.isArray(cat.keywords) ? cat.keywords : []
      }));
    }
    return Object.entries(this.categories).map(([id, cat]) => ({
      id,
      path: cat.path,
      keywords: cat.keywords
    }));
  }

  /**
   * Detect project category from description
   */
  detectCategory(description) {
    if (this.projectTypeService && typeof this.projectTypeService.detectCategory === 'function') {
      return this.projectTypeService.detectCategory(description);
    }
    const lowerDesc = String(description || '').toLowerCase();

    for (const [categoryId, category] of Object.entries(this.categories)) {
      for (const keyword of category.keywords) {
        if (lowerDesc.includes(keyword)) {
          return categoryId;
        }
      }
    }

    return 'other';
  }

  /**
   * Create GitHub remote repository
   */
  async createGitHubRepo(projectName, isPrivate = true, description = '') {
    logger.info('Creating GitHub repository', { projectName, isPrivate });

    try {
      const visibility = isPrivate ? '--private' : '--public';
      const descFlag = description ? `--description "${description}"` : '';

      const { stdout } = await execAsync(
        `gh repo create ${projectName} ${visibility} ${descFlag} --source=. --remote=origin --push`,
        { timeout: 60000 }
      );

      logger.info('GitHub repository created', { stdout: stdout.trim() });
      return { success: true, url: stdout.trim() };
    } catch (error) {
      logger.error('Failed to create GitHub repo', { error: error.message });
      throw new Error(`Failed to create GitHub repository: ${error.message}`);
    }
  }

  /**
   * Full greenfield project creation with GitHub and Claude spawning
   *
   * @param {Object} options
   * @param {string} options.name - Project name (kebab-case)
   * @param {string} options.description - What the project should do
   * @param {string} options.category - Category (auto-detected if not provided)
   * @param {boolean} options.isPrivate - GitHub repo visibility (default: true)
   * @param {number} options.worktreeCount - Number of worktrees (default: 8)
   * @param {boolean} options.spawnClaude - Start Claude in work1 (default: true)
   * @param {boolean} options.yolo - Use skip-permissions mode (default: true)
   */
  async createFullProject(options) {
    const {
      name,
      description,
      category: providedCategory,
      isPrivate = true,
      worktreeCount = 8,
      spawnClaude = true,
      yolo = true
    } = options;

    logger.info('Starting full greenfield project creation', { name, description });

    // Validate name
    if (!name || !name.match(/^[a-z0-9-]+$/)) {
      throw new Error('Invalid project name. Use lowercase letters, numbers, and hyphens only.');
    }

    // Detect or use provided category
    const category = providedCategory || this.detectCategory(description);
    const categoryConfig = this.projectTypeService?.getCategoryById?.(category)
      || this.categories[category]
      || this.categories.other;
    const basePath = expandUserPath(categoryConfig.basePathResolved || categoryConfig.path);

    logger.info('Detected category', { category, basePath });

    // Ensure base path exists
    await fs.mkdir(basePath, { recursive: true });

    const projectPath = path.join(basePath, name);

    // Check if directory exists
    if (fsSync.existsSync(projectPath)) {
      throw new Error(`Project already exists: ${projectPath}`);
    }

    try {
      // Step 1: Create project directory
      await fs.mkdir(projectPath, { recursive: true });
      logger.info('Created project directory', { projectPath });

      // Step 2: Create master folder structure
      const masterPath = path.join(projectPath, 'master');
      await fs.mkdir(masterPath, { recursive: true });

      // Step 3: Create initial files
      await this.createInitialFiles(masterPath, name, description);

      // Step 4: Initialize git in master
      await execAsync('git init', { cwd: masterPath });
      await execAsync('git add .', { cwd: masterPath });
      await execAsync(
        'git -c user.name="Agent Workspace" -c user.email="orchestrator@local" commit -m "Initial commit"',
        { cwd: masterPath }
      );
      logger.info('Git initialized in master');

      // Step 5: Create GitHub remote and push
      let repoUrl = null;
      try {
        const result = await execAsync(
          `gh repo create ${name} ${isPrivate ? '--private' : '--public'} --source=. --remote=origin --push`,
          { cwd: masterPath, timeout: 60000 }
        );
        const remoteUrl = await this.getRemoteRepoUrl(masterPath);
        repoUrl = remoteUrl || this.normalizeRepoUrl(result.stdout);
        logger.info('GitHub repo created and pushed', { repoUrl });
      } catch (ghError) {
        logger.warn('GitHub repo creation failed, continuing without remote', { error: ghError.message });
      }

      // Step 6: Create worktrees
      const worktrees = [{ id: 'master', path: masterPath }];
      for (let i = 1; i <= worktreeCount; i++) {
        const worktreePath = path.join(projectPath, `work${i}`);
        const branchName = `work${i}`;

        try {
          await execAsync(`git branch ${branchName}`, { cwd: masterPath });
        } catch (e) {
          // Branch might already exist
        }

        await execAsync(`git worktree add "${worktreePath}" ${branchName}`, { cwd: masterPath });
        worktrees.push({ id: `work${i}`, path: worktreePath });
        logger.info('Created worktree', { branchName, worktreePath });
      }

      // Step 7: Save project brief for Claude
      const briefPath = path.join(projectPath, 'PROJECT_BRIEF.md');
      await this.saveProjectBrief(briefPath, { name, description, category, worktrees });

      // Step 8: Spawn Claude in work1 if requested
      let claudeSession = null;
      if (spawnClaude && this.sessionManager) {
        const work1Path = worktrees.find(w => w.id === 'work1')?.path;
        if (work1Path) {
          claudeSession = await this.spawnClaudeInProject(work1Path, name, description, yolo);
        }
      }

      logger.info('Full greenfield project created successfully', {
        projectPath,
        worktreeCount: worktrees.length,
        repoUrl,
        claudeSpawned: !!claudeSession
      });

      return {
        success: true,
        projectPath,
        masterPath,
        worktrees,
        repoUrl,
        category,
        claudeSession,
        briefPath
      };

    } catch (error) {
      logger.error('Failed to create full project', { error: error.message });

      // Cleanup on failure
      try {
        await fs.rm(projectPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn('Cleanup failed', { cleanupError: cleanupError.message });
      }

      throw error;
    }
  }

  /**
   * Create initial project files
   */
  async createInitialFiles(masterPath, projectName, description) {
    // README.md
    const readme = `# ${projectName}

${description}

## Getting Started

This project was created with Agent Workspace's Greenfield wizard.

## Development

Each \`work*\` folder is a git worktree for parallel development.
`;
    await fs.writeFile(path.join(masterPath, 'README.md'), readme);

    // .gitignore
    const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`;
    await fs.writeFile(path.join(masterPath, '.gitignore'), gitignore);

    // CLAUDE.md with project context
    const claudeMd = `# ${projectName}

## Project Description
${description}

## Getting Started
- Read this entire file before starting work
- Check PROJECT_BRIEF.md for full requirements

## Development Notes
- This is a new project - build from scratch
- Follow best practices for the chosen stack
`;
    await fs.writeFile(path.join(masterPath, 'CLAUDE.md'), claudeMd);

    logger.info('Created initial project files');
  }

  /**
   * Save project brief for context handoff
   */
  async saveProjectBrief(briefPath, { name, description, category, worktrees }) {
    const brief = `# Project Brief: ${name}

## Original Request
${description}

## Project Details
- **Name**: ${name}
- **Category**: ${category}
- **Created**: ${new Date().toISOString()}
- **Worktrees**: ${worktrees.map(w => w.id).join(', ')}

## Instructions for Claude
1. Read this brief to understand the project goal
2. Design the architecture based on the description
3. Implement the solution step by step
4. Create tests as you go
5. Update README.md with actual setup instructions

## Context
This project was created via the Greenfield wizard. You are starting fresh.
Build exactly what was described above.
`;
    await fs.writeFile(briefPath, brief);
    logger.info('Saved project brief', { briefPath });
  }

  /**
   * Spawn Claude Code in the project directory
   */
  async spawnClaudeInProject(workPath, projectName, description, yolo = true) {
    logger.info('Spawning Claude in project', { workPath, projectName, yolo });

    if (!this.sessionManager) {
      logger.warn('SessionManager not available, cannot spawn Claude');
      return null;
    }

    try {
      // Create a unique session ID
      const sessionId = `greenfield-${projectName}-work1`;

      // Build the initial prompt for Claude
      const initialPrompt = `Read PROJECT_BRIEF.md in the parent directory and CLAUDE.md here.
Your task: ${description}
Start by understanding the requirements, then design and implement the solution.`;

      // Emit event for UI to create terminal
      if (this.io) {
        this.io.emit('greenfield-claude-spawn', {
          sessionId,
          workPath,
          projectName,
          initialPrompt,
          yolo
        });
      }

      logger.info('Emitted greenfield-claude-spawn event', { sessionId });

      return {
        sessionId,
        workPath,
        initialPrompt
      };

    } catch (error) {
      logger.error('Failed to spawn Claude', { error: error.message });
      return null;
    }
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
    const expandedPath = expandUserPath(parentPath);
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
    await execAsync(
      'git -c user.name="Agent Workspace" -c user.email="orchestrator@local" commit -m "Initial commit"',
      { cwd: projectPath }
    );

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
    const expandedPath = expandUserPath(projectPath);

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
