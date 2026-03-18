#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    sourceDir: process.cwd(),
    outDir: '',
    authorName: '',
    authorEmail: '',
    commitMessage: 'chore: public release snapshot',
    json: false,
    noGitInit: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--source' || token === '--source-dir') && next) {
      args.sourceDir = next;
      index += 1;
      continue;
    }

    if ((token === '--out' || token === '--out-dir') && next) {
      args.outDir = next;
      index += 1;
      continue;
    }

    if ((token === '--author-name' || token === '--name') && next) {
      args.authorName = next;
      index += 1;
      continue;
    }

    if ((token === '--author-email' || token === '--email') && next) {
      args.authorEmail = next;
      index += 1;
      continue;
    }

    if ((token === '--commit-message' || token === '--message') && next) {
      args.commitMessage = next;
      index += 1;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--no-git-init') {
      args.noGitInit = true;
    }
  }

  return args;
}

function run(command, cmdArgs, options = {}) {
  return spawnSync(command, cmdArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function runOrThrow(command, cmdArgs, options = {}) {
  const result = run(command, cmdArgs, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${cmdArgs.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function ensureInsideGitRepo(sourceDir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: sourceDir,
      encoding: 'utf8'
    }).trim();
    if (out !== 'true') throw new Error('Not inside git repo');
  } catch (_error) {
    throw new Error(`Source directory is not a git repo: ${sourceDir}`);
  }
}

function resolveDefaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  return path.join(os.tmpdir(), `agent-workspace-public-snapshot-${stamp}`);
}

function getTrackedFiles(sourceDir) {
  const result = runOrThrow('git', ['ls-files', '-z'], { cwd: sourceDir });
  const files = String(result.stdout || '')
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean);
  return files;
}

function ensureParent(targetFile) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
}

function copyTrackedFiles(sourceDir, outDir, files) {
  for (const relativePath of files) {
    const sourceFile = path.join(sourceDir, relativePath);
    const targetFile = path.join(outDir, relativePath);
    ensureParent(targetFile);
    fs.copyFileSync(sourceFile, targetFile);
  }
}

function getDefaultIdentity(sourceDir) {
  const read = (scope, key) => {
    const args = scope ? ['config', scope, key] : ['config', key];
    const result = run('git', args, { cwd: sourceDir });
    if (result.status !== 0) return '';
    return String(result.stdout || '').trim();
  };

  return {
    name: read('--global', 'user.name') || read('', 'user.name') || 'public-release-bot',
    email: read('--global', 'user.email') || read('', 'user.email') || 'noreply@example.com'
  };
}

function initSnapshotGitRepo(outDir, authorName, authorEmail, commitMessage) {
  runOrThrow('git', ['init'], { cwd: outDir });
  runOrThrow('git', ['config', 'user.name', authorName], { cwd: outDir });
  runOrThrow('git', ['config', 'user.email', authorEmail], { cwd: outDir });
  runOrThrow('git', ['add', '-A'], { cwd: outDir });
  runOrThrow('git', ['commit', '-m', commitMessage], { cwd: outDir });
}

function printSummary(summary, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write('Public snapshot repo created\n');
  process.stdout.write(`- sourceDir: ${summary.sourceDir}\n`);
  process.stdout.write(`- outDir: ${summary.outDir}\n`);
  process.stdout.write(`- trackedFilesCopied: ${summary.trackedFilesCopied}\n`);
  process.stdout.write(`- gitInitialized: ${summary.gitInitialized ? 'yes' : 'no'}\n`);
  if (summary.gitInitialized) {
    process.stdout.write(`- commit: ${summary.commitHash}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const sourceDir = path.resolve(args.sourceDir);
  const outDir = path.resolve(args.outDir || resolveDefaultOutputDir());

  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`Output directory is not empty: ${outDir}`);
  }

  ensureInsideGitRepo(sourceDir);
  fs.mkdirSync(outDir, { recursive: true });

  const trackedFiles = getTrackedFiles(sourceDir);
  copyTrackedFiles(sourceDir, outDir, trackedFiles);

  const defaults = getDefaultIdentity(sourceDir);
  const authorName = args.authorName || defaults.name;
  const authorEmail = args.authorEmail || defaults.email;

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDir,
    outDir,
    trackedFilesCopied: trackedFiles.length,
    gitInitialized: false,
    commitHash: ''
  };

  if (!args.noGitInit) {
    initSnapshotGitRepo(outDir, authorName, authorEmail, args.commitMessage);
    const hash = runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: outDir }).stdout.trim();
    summary.gitInitialized = true;
    summary.commitHash = hash;
    summary.authorName = authorName;
    summary.authorEmail = authorEmail;
  }

  printSummary(summary, args.json);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
}
