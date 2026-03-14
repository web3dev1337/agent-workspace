#!/usr/bin/env node
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const CREATE_NO_WINDOW = 0x08000000;

function getSpawnOptions(options = {}) {
  return {
    ...options,
    ...(IS_WIN
      ? {
          windowsHide: options.windowsHide ?? true,
          creationFlags: options.creationFlags ?? CREATE_NO_WINDOW
        }
      : {})
  };
}
const { ProjectTypeService } = require('../server/projectTypeService');
const { WorktreeHelper } = require('../server/worktreeHelper');

function normalizeString(value) {
  return String(value || '').trim();
}

function expandUserPath(input) {
  const raw = normalizeString(input);
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function isUrl(value) {
  const v = normalizeString(value);
  return /^https?:\/\//i.test(v) || /^git@/i.test(v) || /^ssh:\/\//i.test(v);
}

function toKebabCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    if (!key) continue;

    if (key === 'help' || key === 'h') {
      out.help = true;
      continue;
    }

    if (key.startsWith('no-')) {
      out[key.slice(3)] = false;
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/create-project.js [options]\n\nOptions:\n  --name <slug>                     Project name (required; kebab-case)\n  --description <text>              Project description\n  --category <id>                   Category id from project taxonomy\n  --framework <id>                  Framework id from project taxonomy\n  --template <id>                   Template id from project taxonomy\n  --base-path <path>                Override category base path\n  --repo <url-or-slug>              Optional remote URL or GitHub slug\n  --github-org <org>                GitHub org/user for slug repos\n  --create-github <bool>            Create repo via gh CLI when repo is slug (default: false)\n  --private <bool>                  Visibility for gh repo create (default: true)\n  --push <bool>                     Push initial commit (default: false)\n  --init-git <bool>                 Initialize git (default: true)\n  --worktree-count <n>              Create work1..workN (default: 0)\n  --run-post-create <bool>          Run template post-create hooks (default: true)\n  --allow-post-create-failure <bool>Continue when post-create command fails (default: true)\n  --help                            Show this help\n`);
}

function resolveRemoteSpec(repoValue, githubOrg = '') {
  const raw = normalizeString(repoValue);
  if (!raw) {
    return { remoteUrl: null, slug: null, shouldCreate: false };
  }

  if (isUrl(raw)) {
    return { remoteUrl: raw, slug: null, shouldCreate: false };
  }

  const slug = raw.includes('/') ? raw : `${normalizeString(githubOrg) || ''}${normalizeString(githubOrg) ? '/' : ''}${raw}`;
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, '');
  if (!normalizedSlug) {
    return { remoteUrl: null, slug: null, shouldCreate: false };
  }

  return {
    remoteUrl: `https://github.com/${normalizedSlug}.git`,
    slug: normalizedSlug,
    shouldCreate: true
  };
}

function isLikelyBinary(buffer) {
  const len = Math.min(buffer.length, 1024);
  for (let i = 0; i < len; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function replaceTemplateVars(text, vars) {
  let out = String(text || '');
  for (const [key, value] of Object.entries(vars || {})) {
    const pattern = new RegExp(`{{\\s*${String(key)}\\s*}}`, 'g');
    out = out.replace(pattern, String(value || ''));
  }
  return out;
}

async function copyTemplateTree(srcDir, destDir, vars = {}) {
  await fsp.mkdir(destDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyTemplateTree(srcPath, destPath, vars);
      continue;
    }

    if (!entry.isFile()) continue;
    const buffer = await fsp.readFile(srcPath);
    if (isLikelyBinary(buffer)) {
      await fsp.writeFile(destPath, buffer);
      continue;
    }

    const rendered = replaceTemplateVars(buffer.toString('utf8'), vars);
    await fsp.writeFile(destPath, rendered, 'utf8');
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...getSpawnOptions({
        cwd: options.cwd || process.cwd(),
        stdio: options.stdio || ['ignore', 'pipe', 'pipe']
      })
    });

    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk || '');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stderr || stdout}`));
      }
    });
  });
}

function runShellCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      ...getSpawnOptions({
        cwd: options.cwd || process.cwd(),
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
        shell: options.shell || true
      })
    });

    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk || '');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
      }
    });
  });
}

function buildTemplateSourceCandidates(template = {}) {
  const out = [];
  const push = (value) => {
    const next = normalizeString(value);
    if (!next || out.includes(next)) return;
    out.push(next);
  };

  push(template.scaffoldPath);
  push(template.projectKitPath);

  const scaffoldPath = normalizeString(template.scaffoldPath);
  if (scaffoldPath.startsWith('templates/scaffolds/')) {
    push(scaffoldPath.replace(/^templates\/scaffolds\//, 'templates/project-kits/'));
  } else if (scaffoldPath.startsWith('templates/project-kits/')) {
    push(scaffoldPath.replace(/^templates\/project-kits\//, 'templates/scaffolds/'));
  }

  const templateId = normalizeString(template.id);
  if (templateId) {
    push(`templates/project-kits/${templateId}`);
  }

  return out;
}

function resolveTemplateSourceDir(template = {}) {
  const candidates = buildTemplateSourceCandidates(template)
    .map((candidate) => (path.isAbsolute(candidate) ? candidate : path.resolve(path.join(__dirname, '..', candidate))));

  for (const candidatePath of candidates) {
    try {
      const stat = fs.statSync(candidatePath);
      if (stat.isDirectory()) return { sourcePath: candidatePath, checkedPaths: candidates };
    } catch {
      // ignore missing candidate
    }
  }

  return { sourcePath: '', checkedPaths: candidates };
}

function normalizeCommandList(raw) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = normalizeString(item);
    if (!value) continue;
    out.push(value);
  }
  return out;
}

async function runPostCreateCommands(commands = [], { cwd, vars = {}, allowFailure = true, logger = console } = {}) {
  const executed = [];
  const warnings = [];
  const normalized = normalizeCommandList(commands);
  for (const command of normalized) {
    const rendered = replaceTemplateVars(command, vars);
    try {
      const result = await runShellCommand(rendered, { cwd });
      executed.push({
        command: rendered,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      });
    } catch (error) {
      const message = `Post-create command failed: ${rendered} :: ${error.message}`;
      if (!allowFailure) throw new Error(message);
      warnings.push(message);
      logger.warn?.(message);
    }
  }
  return { executed, warnings };
}

async function initializeGitRepo(masterPath) {
  await runCommand('git', ['init'], { cwd: masterPath });
  await runCommand('git', ['checkout', '-B', 'master'], { cwd: masterPath });
  await runCommand('git', ['add', '.'], { cwd: masterPath });
  await runCommand('git', ['-c', 'user.name=Agent Workspace', '-c', 'user.email=orchestrator@local', 'commit', '-m', 'Initial scaffold'], { cwd: masterPath });
}

async function wireRemote({
  masterPath,
  repo,
  githubOrg,
  createGithub = false,
  isPrivate = true,
  push = false,
  allowGitHubFailure = true
}) {
  const spec = resolveRemoteSpec(repo, githubOrg);
  if (!spec.remoteUrl && !spec.slug) {
    return { remoteUrl: null, repoSlug: null, createdViaGh: false, warnings: [] };
  }

  if (createGithub && spec.shouldCreate && spec.slug) {
    const visibility = isPrivate ? '--private' : '--public';
    const args = ['repo', 'create', spec.slug, visibility, '--source=.', '--remote=origin'];
    if (push) args.push('--push');
    try {
      await runCommand('gh', args, { cwd: masterPath });
      return {
        remoteUrl: spec.remoteUrl,
        repoSlug: spec.slug,
        createdViaGh: true,
        warnings: []
      };
    } catch (error) {
      if (!allowGitHubFailure) throw error;
      return {
        remoteUrl: null,
        repoSlug: spec.slug,
        createdViaGh: false,
        warnings: [`GitHub repo creation failed: ${error.message}`]
      };
    }
  }

  await runCommand('git', ['remote', 'add', 'origin', spec.remoteUrl], { cwd: masterPath });
  if (push) {
    await runCommand('git', ['push', '-u', 'origin', 'master'], { cwd: masterPath });
  }

  return {
    remoteUrl: spec.remoteUrl,
    repoSlug: spec.slug,
    createdViaGh: false,
    warnings: []
  };
}

function resolveProjectSpec(service, options = {}) {
  const name = toKebabCase(options.name || options.projectName || '');
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Invalid project name. Use lowercase letters, numbers, and hyphens only.');
  }

  const description = normalizeString(options.description || '');

  const requestedCategory = normalizeString(options.category || options.categoryId);
  const categoryId = requestedCategory || service.detectCategory(description) || 'other';
  const category = service.getCategoryById(categoryId);
  if (!category) {
    throw new Error(`Unknown category: ${categoryId}`);
  }

  const requestedFramework = normalizeString(options.framework || options.frameworkId);
  const frameworkCandidates = service.getFrameworks({ categoryId: category.id });
  const framework = requestedFramework
    ? frameworkCandidates.find((item) => item.id === requestedFramework)
    : (frameworkCandidates[0] || null);

  const requestedTemplate = normalizeString(options.template || options.templateId);
  const templateCandidates = framework
    ? service.getTemplates({ frameworkId: framework.id })
    : service.getTemplates({ categoryId: category.id });
  let template = null;
  if (requestedTemplate) {
    template = templateCandidates.find((item) => item.id === requestedTemplate)
      || service.getTemplates().find((item) => item.id === requestedTemplate)
      || null;
  } else {
    const preferredId = framework?.defaultTemplateId || category.defaultTemplateId || '';
    template = templateCandidates.find((item) => item.id === preferredId)
      || templateCandidates[0]
      || null;
  }
  if (!template) {
    throw new Error(`No template found for category ${category.id}`);
  }

  const basePath = normalizeString(options.basePath || options.base_path)
    ? path.resolve(expandUserPath(options.basePath || options.base_path))
    : path.resolve(expandUserPath(category.basePathResolved || category.basePath || path.join(os.homedir(), 'GitHub', 'projects')));

  return {
    name,
    description,
    category,
    framework,
    template,
    basePath
  };
}

async function createProject(options = {}) {
  const logger = options.logger || console;
  const service = options.projectTypeService || ProjectTypeService.getInstance({ logger });
  const worktreeHelper = options.worktreeHelper || new WorktreeHelper();
  const spec = resolveProjectSpec(service, options);

  const projectPath = path.join(spec.basePath, spec.name);
  const masterPath = path.join(projectPath, 'master');
  const metadataPath = path.join(projectPath, 'project.json');
  const templateSourceResolution = resolveTemplateSourceDir(spec.template);
  const templateSource = templateSourceResolution.sourcePath;

  if (fs.existsSync(projectPath)) {
    throw new Error(`Project already exists: ${projectPath}`);
  }

  await fsp.mkdir(masterPath, { recursive: true });

  const templateVars = {
    projectName: spec.name,
    projectDescription: spec.description,
    categoryId: spec.category.id,
    templateId: spec.template.id,
    frameworkId: spec.framework?.id || ''
  };

  if (templateSource) {
    await copyTemplateTree(templateSource, masterPath, templateVars);
  } else {
    await fsp.writeFile(path.join(masterPath, 'README.md'), `# ${spec.name}\n\n${spec.description || 'New project scaffold.'}\n`, 'utf8');
  }

  const projectMetadata = {
    version: 1,
    name: spec.name,
    description: spec.description,
    categoryId: spec.category.id,
    frameworkId: spec.framework?.id || null,
    templateId: spec.template.id,
    repositoryType: spec.template.defaultRepositoryType || spec.category.defaultRepositoryType || 'generic',
    launchSettingsType: spec.template.defaultLaunchSettingsType || spec.category.defaultLaunchSettingsType || 'website',
    buttonProfileId: spec.template.buttonProfileId || spec.category.buttonProfileId || 'generic',
    worktreeNamingPattern: 'work{n}',
    createdAt: new Date().toISOString(),
    paths: {
      root: projectPath,
      master: masterPath
    }
  };
  await fsp.writeFile(metadataPath, JSON.stringify(projectMetadata, null, 2), 'utf8');

  const initGit = options.initGit !== undefined ? parseBool(options.initGit, true) : true;
  const worktreeCount = Math.max(0, Number(options.worktreeCount || options.worktrees || 0) || 0);
  let remoteInfo = { remoteUrl: null, repoSlug: null, createdViaGh: false, warnings: [] };
  let additionalWorktrees = [];
  let postCreate = { executed: [], warnings: [] };

  const postCreateCommands = normalizeCommandList(options.postCreateCommands || spec.template.postCreateCommands || []);
  const runPostCreate = options.runPostCreate !== undefined ? parseBool(options.runPostCreate, true) : true;
  const allowPostCreateFailure = options.allowPostCreateFailure !== undefined ? parseBool(options.allowPostCreateFailure, true) : true;
  if (runPostCreate && postCreateCommands.length) {
    postCreate = await runPostCreateCommands(postCreateCommands, {
      cwd: masterPath,
      vars: templateVars,
      allowFailure: allowPostCreateFailure,
      logger
    });
  }

  if (initGit) {
    await initializeGitRepo(masterPath);

    if (normalizeString(options.repo)) {
      remoteInfo = await wireRemote({
        masterPath,
        repo: options.repo,
        githubOrg: options.githubOrg || options.github_org,
        createGithub: parseBool(options.createGithub, false),
        isPrivate: parseBool(options.private, true),
        push: parseBool(options.push, false),
        allowGitHubFailure: parseBool(options.allowGitHubFailure, true)
      });
    }

    if (worktreeCount > 0) {
      additionalWorktrees = await worktreeHelper.createProjectWorktrees({
        projectPath,
        count: worktreeCount,
        baseBranch: 'master'
      });
    }
  }

  const worktrees = [{ id: 'master', path: masterPath }, ...additionalWorktrees];

  return {
    success: true,
    name: spec.name,
    projectPath,
    masterPath,
    metadataPath,
    categoryId: spec.category.id,
    frameworkId: spec.framework?.id || null,
    templateId: spec.template.id,
    repositoryType: projectMetadata.repositoryType,
    launchSettingsType: projectMetadata.launchSettingsType,
    buttonProfileId: projectMetadata.buttonProfileId,
    templateSourcePath: templateSource || null,
    templateSourceCandidates: templateSourceResolution.checkedPaths,
    remoteUrl: remoteInfo.remoteUrl,
    repoSlug: remoteInfo.repoSlug,
    createdViaGh: remoteInfo.createdViaGh,
    warnings: [
      ...(Array.isArray(remoteInfo.warnings) ? remoteInfo.warnings : []),
      ...(Array.isArray(postCreate.warnings) ? postCreate.warnings : [])
    ],
    postCreate: {
      executed: Array.isArray(postCreate.executed) ? postCreate.executed : [],
      warnings: Array.isArray(postCreate.warnings) ? postCreate.warnings : []
    },
    worktrees
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  try {
    const result = await createProject(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`create-project failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createProject,
  resolveProjectSpec,
  parseArgs,
  toKebabCase,
  resolveRemoteSpec,
  buildTemplateSourceCandidates,
  resolveTemplateSourceDir,
  runPostCreateCommands
};
