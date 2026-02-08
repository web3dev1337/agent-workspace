#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXECUTE_TOKEN = 'I_UNDERSTAND_HISTORY_REWRITE';
const PUSH_TOKEN = 'PUSH_REWRITTEN_HISTORY';

function parseArgs(argv) {
  const args = {
    workkitDir: '',
    cloneDir: '',
    execute: false,
    push: false,
    confirm: '',
    confirmPush: '',
    skipVerify: false,
    json: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--workkit' || token === '--workkit-dir') && next) {
      args.workkitDir = next;
      index += 1;
      continue;
    }

    if ((token === '--clone' || token === '--clone-dir') && next) {
      args.cloneDir = next;
      index += 1;
      continue;
    }

    if (token === '--execute') {
      args.execute = true;
      continue;
    }

    if (token === '--push') {
      args.push = true;
      continue;
    }

    if ((token === '--confirm' || token === '--i-know-what-i-am-doing') && next) {
      args.confirm = next;
      index += 1;
      continue;
    }

    if ((token === '--confirm-push' || token === '--confirm-force-push') && next) {
      args.confirmPush = next;
      index += 1;
      continue;
    }

    if (token === '--skip-verify') {
      args.skipVerify = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
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

function assertPathExists(targetPath, label) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath || '(empty)'}`);
  }
}

function readListFile(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function ensureCleanRepo(cloneDir) {
  const status = run('git', ['status', '--porcelain'], { cwd: cloneDir });
  if (status.status !== 0) {
    throw new Error(`Failed to read git status: ${status.stderr || status.stdout}`);
  }
  if (String(status.stdout || '').trim()) {
    throw new Error('Rewrite clone has uncommitted changes. Use a clean clone.');
  }
}

function validateMailmap(mailmapPath) {
  const content = fs.readFileSync(mailmapPath, 'utf8');
  if (content.includes('REPLACE_WITH_NOREPLY_EMAIL')) {
    throw new Error(`Mailmap still has placeholders: ${mailmapPath}`);
  }
}

function buildFilterRepoArgs(mailmapPath, blockedPaths) {
  const args = ['filter-repo', '--force', '--mailmap', mailmapPath, '--invert-paths'];
  for (const blockedPath of blockedPaths) {
    args.push('--path', blockedPath);
  }
  return args;
}

function formatPlan(args, mailmapPath, blockedPaths, filterRepoAvailable) {
  return {
    mode: args.execute ? 'execute' : 'plan',
    pushRequested: args.push,
    workkitDir: args.workkitDir,
    cloneDir: args.cloneDir,
    mailmapPath,
    filterRepoAvailable,
    blockedPaths,
    filterRepoCommand: ['git', ...buildFilterRepoArgs(mailmapPath, blockedPaths)].join(' '),
    postVerifyCommand: args.skipVerify
      ? '(skipped)'
      : 'npm run check:history-rewrite-result'
  };
}

function printPlan(plan, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  process.stdout.write('History rewrite executor\n');
  process.stdout.write(`- mode: ${plan.mode}\n`);
  process.stdout.write(`- workkitDir: ${plan.workkitDir}\n`);
  process.stdout.write(`- cloneDir: ${plan.cloneDir}\n`);
  process.stdout.write(`- mailmapPath: ${plan.mailmapPath}\n`);
  process.stdout.write(`- git-filter-repo-available: ${plan.filterRepoAvailable ? 'yes' : 'no'}\n`);
  process.stdout.write(`- blockedPaths: ${plan.blockedPaths.length}\n`);
  process.stdout.write(`- filter-repo: ${plan.filterRepoCommand}\n`);
  process.stdout.write(`- post-verify: ${plan.postVerifyCommand}\n`);
  process.stdout.write(`- pushRequested: ${plan.pushRequested ? 'yes' : 'no'}\n`);
}

function runRewrite(plan, args) {
  const filterArgs = buildFilterRepoArgs(plan.mailmapPath, plan.blockedPaths);
  const filterResult = run('git', filterArgs, { cwd: plan.cloneDir, stdio: 'inherit' });
  if (filterResult.status !== 0) {
    throw new Error(`git filter-repo failed with exit code ${filterResult.status}`);
  }

  if (!args.skipVerify) {
    const verifyResult = run('npm', ['run', 'check:history-rewrite-result'], { cwd: plan.cloneDir, stdio: 'inherit' });
    if (verifyResult.status !== 0) {
      throw new Error('Post-rewrite verification failed. Aborting before any push.');
    }
  }

  if (args.push) {
    if (args.confirmPush !== PUSH_TOKEN) {
      throw new Error(`Force-push requested but missing required --confirm-push ${PUSH_TOKEN}`);
    }

    const pushAll = run('git', ['push', 'origin', '--force', '--all'], { cwd: plan.cloneDir, stdio: 'inherit' });
    if (pushAll.status !== 0) {
      throw new Error('Force push --all failed.');
    }

    const pushTags = run('git', ['push', 'origin', '--force', '--tags'], { cwd: plan.cloneDir, stdio: 'inherit' });
    if (pushTags.status !== 0) {
      throw new Error('Force push --tags failed.');
    }
  }
}

function main() {
  const args = parseArgs(process.argv);

  try {
    const workkitDir = path.resolve(args.workkitDir || '');
    const cloneDir = path.resolve(args.cloneDir || '');

    assertPathExists(workkitDir, 'Workkit dir');
    assertPathExists(cloneDir, 'Rewrite clone dir');

    const mailmapPath = path.join(workkitDir, 'mailmap.private.txt');
    const blockedPathsFile = path.join(workkitDir, 'paths-to-remove.txt');

    assertPathExists(mailmapPath, 'mailmap.private.txt');
    assertPathExists(blockedPathsFile, 'paths-to-remove.txt');
    validateMailmap(mailmapPath);
    ensureCleanRepo(cloneDir);

    const blockedPaths = readListFile(blockedPathsFile);
    if (!blockedPaths.length) {
      throw new Error('No blocked paths found in paths-to-remove.txt.');
    }

    const filterRepoAvailable = run('git-filter-repo', ['--help']).status === 0;
    const plan = formatPlan({ ...args, workkitDir, cloneDir }, mailmapPath, blockedPaths, filterRepoAvailable);

    if (!args.execute) {
      printPlan(plan, args.json);
      return;
    }

    if (args.confirm !== EXECUTE_TOKEN) {
      throw new Error(`Execution blocked. Pass --confirm ${EXECUTE_TOKEN} to run rewrite.`);
    }

    if (!filterRepoAvailable) {
      throw new Error('git-filter-repo not found on PATH.');
    }

    printPlan(plan, false);
    runRewrite(plan, args);
    process.stdout.write('Rewrite execution completed successfully.\n');
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  }
}

main();
