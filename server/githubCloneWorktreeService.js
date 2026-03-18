const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const COMMAND_TIMEOUT_MS = 180000;
const COMMAND_MAX_BUFFER = 8 * 1024 * 1024;

function normalizeSlashPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').trim();
}

function parseGitHubRepoInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withoutProto = raw
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = withoutProto.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1];
  if (!owner || !repo) return null;

  return {
    owner,
    repo,
    nameWithOwner: `${owner}/${repo}`
  };
}

function splitRelativePath(rawValue) {
  const normalized = normalizeSlashPath(rawValue);
  if (!normalized) return [];

  const out = [];
  for (const segment of normalized.split('/')) {
    const trimmed = String(segment || '').trim();
    if (!trimmed || trimmed === '.') continue;
    if (trimmed === '..') {
      throw new Error('Folder path cannot contain ".." segments');
    }
    if (/[:*?"<>|]/.test(trimmed)) {
      throw new Error(`Folder segment contains unsupported characters: ${trimmed}`);
    }
    out.push(trimmed);
  }
  return out;
}

function validateInsideBase(basePath, candidatePath, label) {
  const baseResolved = path.resolve(basePath);
  const candidateResolved = path.resolve(candidatePath);
  const rel = path.relative(baseResolved, candidateResolved);
  if (rel === '' || rel === '.') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const error = new Error(`${label} escapes the selected base path`);
    error.statusCode = 400;
    throw error;
  }
}

class GitHubCloneWorktreeService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.projectTypeService = options.projectTypeService;
  }

  static getInstance(options = {}) {
    if (!GitHubCloneWorktreeService.instance) {
      GitHubCloneWorktreeService.instance = new GitHubCloneWorktreeService(options);
    }
    return GitHubCloneWorktreeService.instance;
  }

  runCommand(command, args, { cwd, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        cwd,
        timeout: Math.max(10_000, Number(timeoutMs) || COMMAND_TIMEOUT_MS),
        maxBuffer: COMMAND_MAX_BUFFER,
        env: augmentProcessEnv(process.env)
      };

      execFile(command, args, getHiddenProcessOptions(options), (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || stdout || error.message || 'Command failed').trim();
          const wrapped = new Error(message || `${command} failed`);
          wrapped.command = command;
          wrapped.args = args;
          wrapped.cwd = cwd;
          wrapped.code = error.code;
          wrapped.statusCode = 500;
          reject(wrapped);
          return;
        }

        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  getTaxonomy() {
    if (!this.projectTypeService) {
      const fallbackRoot = process.env.GREENFIELD_GITHUB_ROOT
        || process.env.GITHUB_ROOT
        || path.join(os.homedir(), 'GitHub');
      return {
        gitHubRoot: path.resolve(String(fallbackRoot || path.join(os.homedir(), 'GitHub')).replace(/^~\//, `${os.homedir()}/`)),
        categories: [],
        frameworks: [],
        templates: []
      };
    }
    return this.projectTypeService.getTaxonomy();
  }

  resolveCategory(categoryId, repoName) {
    const taxonomy = this.getTaxonomy();
    const categories = Array.isArray(taxonomy?.categories) ? taxonomy.categories : [];
    const requested = String(categoryId || '').trim();
    if (requested) {
      const match = categories.find((category) => String(category?.id || '').trim() === requested);
      if (match) return match;
    }

    if (this.projectTypeService?.detectCategory) {
      const detectedId = String(this.projectTypeService.detectCategory(repoName) || '').trim();
      if (detectedId) {
        const detected = categories.find((category) => String(category?.id || '').trim() === detectedId);
        if (detected) return detected;
      }
    }

    return categories[0] || {
      id: 'other',
      name: 'Other',
      basePathResolved: path.join(os.homedir(), 'GitHub', 'projects'),
      defaultRepositoryType: 'generic'
    };
  }

  resolveRepositoryType({ repositoryType, category, frameworkId }) {
    const explicit = String(repositoryType || '').trim();
    if (explicit) return explicit;

    const taxonomy = this.getTaxonomy();
    const frameworks = Array.isArray(taxonomy?.frameworks) ? taxonomy.frameworks : [];
    const templates = Array.isArray(taxonomy?.templates) ? taxonomy.templates : [];
    const requestedFramework = String(frameworkId || '').trim();

    if (requestedFramework) {
      const framework = frameworks.find((row) => String(row?.id || '').trim() === requestedFramework);
      if (framework) {
        const templateId = String(framework?.defaultTemplateId || '').trim();
        if (templateId) {
          const template = templates.find((row) => String(row?.id || '').trim() === templateId);
          const fromTemplate = String(template?.defaultRepositoryType || '').trim();
          if (fromTemplate) return fromTemplate;
        }
      }
    }

    const fromCategory = String(category?.defaultRepositoryType || '').trim();
    if (fromCategory) return fromCategory;
    return 'tool-project';
  }

  resolvePlacement({ repoName, categoryId, parentPath }) {
    const taxonomy = this.getTaxonomy();
    const category = this.resolveCategory(categoryId, repoName);

    const gitHubRoot = path.resolve(String(taxonomy?.gitHubRoot || path.join(os.homedir(), 'GitHub')).replace(/^~\//, `${os.homedir()}/`));
    const categoryBase = path.resolve(String(category?.basePathResolved || path.join(gitHubRoot, 'projects')).replace(/^~\//, `${os.homedir()}/`));

    const segments = splitRelativePath(parentPath || '');
    const parentAbsolutePath = path.resolve(categoryBase, ...segments);
    validateInsideBase(categoryBase, parentAbsolutePath, 'Parent folder path');

    const repositoryPath = path.resolve(parentAbsolutePath, repoName);
    validateInsideBase(categoryBase, repositoryPath, 'Repository path');

    const relativePath = normalizeSlashPath(path.relative(gitHubRoot, repositoryPath));

    return {
      category,
      gitHubRoot,
      categoryBase,
      parentSegments: segments,
      parentPathNormalized: segments.join('/'),
      repositoryPath,
      relativePath
    };
  }

  async ensureRepoRootState({ repositoryPath, createFolders }) {
    const repoRoot = path.resolve(repositoryPath);

    if (!fs.existsSync(repoRoot)) {
      if (!createFolders) {
        const error = new Error(`Repository folder does not exist: ${repoRoot}`);
        error.statusCode = 400;
        throw error;
      }
      await fsp.mkdir(repoRoot, { recursive: true });
      return;
    }

    const stat = await fsp.stat(repoRoot);
    if (!stat.isDirectory()) {
      const error = new Error(`Repository path is not a directory: ${repoRoot}`);
      error.statusCode = 400;
      throw error;
    }
  }

  async cloneRepositoryIfNeeded({ nameWithOwner, repositoryPath, createFolders = true }) {
    const repoRoot = path.resolve(repositoryPath);
    const masterPath = path.join(repoRoot, 'master');
    const mainPath = path.join(repoRoot, 'main');

    if (fs.existsSync(masterPath) || fs.existsSync(mainPath)) {
      return {
        alreadyCloned: true,
        primaryPath: fs.existsSync(masterPath) ? masterPath : mainPath,
        cloneMethod: 'existing'
      };
    }

    await this.ensureRepoRootState({ repositoryPath: repoRoot, createFolders: !!createFolders });

    const entries = await fsp.readdir(repoRoot).catch(() => []);
    const visibleEntries = entries.filter((entry) => !['.DS_Store', 'Thumbs.db'].includes(entry));
    if (visibleEntries.length > 0) {
      const error = new Error(`Target repository folder is not empty: ${repoRoot}`);
      error.statusCode = 400;
      throw error;
    }

    let ghError = null;
    let cloneMethod = '';

    try {
      await this.runCommand('gh', ['repo', 'clone', nameWithOwner, 'master'], { cwd: repoRoot });
      cloneMethod = 'gh';
    } catch (error) {
      ghError = error;
      const message = String(error?.message || '').toLowerCase();
      this.logger.warn?.('gh repo clone failed, attempting git clone fallback', {
        repo: nameWithOwner,
        repositoryPath: repoRoot,
        error: error.message
      });

      if (message.includes('already exists') || message.includes('not empty')) {
        const wrapped = new Error(`Target repository folder is not empty: ${repoRoot}`);
        wrapped.statusCode = 400;
        throw wrapped;
      }
    }

    if (!fs.existsSync(masterPath) && !fs.existsSync(mainPath)) {
      try {
        await this.runCommand('git', ['clone', `https://github.com/${nameWithOwner}.git`, 'master'], { cwd: repoRoot });
        cloneMethod = 'git';
      } catch (error) {
        const hints = [];
        if (ghError) hints.push(`gh: ${ghError.message}`);
        hints.push(`git: ${error.message}`);
        const wrapped = new Error(`Failed to clone ${nameWithOwner}. ${hints.join(' | ')}`);
        wrapped.statusCode = 500;
        throw wrapped;
      }
    }

    const primaryPath = fs.existsSync(masterPath)
      ? masterPath
      : (fs.existsSync(mainPath) ? mainPath : null);

    if (!primaryPath) {
      const error = new Error(`Clone completed but neither master/ nor main/ was created in ${repoRoot}`);
      error.statusCode = 500;
      throw error;
    }

    return {
      alreadyCloned: false,
      primaryPath,
      cloneMethod: cloneMethod || 'unknown'
    };
  }

  async cloneAndAddWorktree({
    workspaceId,
    repo,
    categoryId,
    frameworkId,
    parentPath,
    repositoryType,
    worktreeId,
    startTier,
    createFolders = true,
    ensureWorkspaceMixedWorktree
  } = {}) {
    if (typeof ensureWorkspaceMixedWorktree !== 'function') {
      const error = new Error('Missing ensureWorkspaceMixedWorktree callback');
      error.statusCode = 500;
      throw error;
    }

    const workspaceKey = String(workspaceId || '').trim();
    if (!workspaceKey) {
      const error = new Error('workspaceId is required');
      error.statusCode = 400;
      throw error;
    }

    const parsedRepo = parseGitHubRepoInput(repo);
    if (!parsedRepo) {
      const error = new Error('repo must be owner/name or a GitHub URL');
      error.statusCode = 400;
      throw error;
    }

    const normalizedWorktreeId = String(worktreeId || 'work1').trim().toLowerCase();
    if (!/^work\d+$/.test(normalizedWorktreeId)) {
      const error = new Error('worktreeId must match work{n}');
      error.statusCode = 400;
      throw error;
    }

    const tier = Number(startTier);
    const startTierSafe = tier >= 1 && tier <= 4 ? tier : undefined;
    const placement = this.resolvePlacement({
      repoName: parsedRepo.repo,
      categoryId,
      parentPath
    });

    const cloneResult = await this.cloneRepositoryIfNeeded({
      nameWithOwner: parsedRepo.nameWithOwner,
      repositoryPath: placement.repositoryPath,
      createFolders: !!createFolders
    });

    const resolvedRepositoryType = this.resolveRepositoryType({
      repositoryType,
      category: placement.category,
      frameworkId
    });

    const ensured = await ensureWorkspaceMixedWorktree({
      workspaceId: workspaceKey,
      repositoryPath: placement.repositoryPath,
      repositoryType: resolvedRepositoryType,
      repositoryName: parsedRepo.repo,
      worktreeId: normalizedWorktreeId,
      startTier: startTierSafe
    });

    return {
      workspaceId: workspaceKey,
      repo: {
        owner: parsedRepo.owner,
        name: parsedRepo.repo,
        nameWithOwner: parsedRepo.nameWithOwner,
        repositoryPath: placement.repositoryPath,
        repositoryPathRelativeToGitHub: placement.relativePath,
        categoryId: String(placement.category?.id || ''),
        categoryName: String(placement.category?.name || ''),
        parentPath: placement.parentPathNormalized,
        primaryPath: cloneResult.primaryPath,
        alreadyCloned: cloneResult.alreadyCloned,
        cloneMethod: cloneResult.cloneMethod,
        repositoryType: resolvedRepositoryType
      },
      worktree: {
        id: ensured.worktreeId,
        path: ensured.worktreePath
      },
      sessions: ensured.sessions,
      alreadyInWorkspace: !!ensured.alreadyExists
    };
  }
}

module.exports = {
  GitHubCloneWorktreeService,
  parseGitHubRepoInput,
  splitRelativePath
};
