#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    workkitDir: '',
    allowDirty: false,
    requireGitleaks: false,
    strict: false,
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

    if (token === '--allow-dirty') {
      args.allowDirty = true;
      continue;
    }

    if (token === '--require-gitleaks') {
      args.requireGitleaks = true;
      continue;
    }

    if (token === '--strict') {
      args.strict = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
    }
  }

  return args;
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function runGitSafe(args, fallback = '') {
  try {
    return runGit(args);
  } catch (_error) {
    return fallback;
  }
}

function commandAvailable(command, commandArgs = ['--version']) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  return result.status === 0;
}

function classifyEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return 'empty';
  if (normalized.endsWith('@users.noreply.github.com')) return 'noreply';
  return 'custom';
}

function createCheck(id, ok, detail, hint, severity = 'error') {
  return { id, ok: Boolean(ok), detail, hint, severity };
}

function evaluateRepoChecks(args) {
  const checks = [];

  let isGitRepo = false;
  try {
    isGitRepo = runGit(['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch (_error) {
    isGitRepo = false;
  }

  checks.push(createCheck(
    'git.repo',
    isGitRepo,
    isGitRepo ? 'Inside a git work tree.' : 'Not inside a git work tree.',
    'Run this command from the repository root.'
  ));

  if (!isGitRepo) {
    return checks;
  }

  const originUrl = runGitSafe(['remote', 'get-url', 'origin'], '');

  checks.push(createCheck(
    'git.origin',
    Boolean(originUrl),
    originUrl ? `Origin remote is set: ${originUrl}` : 'Origin remote is missing.',
    'Set origin remote before rewrite prep: git remote add origin <url>.'
  ));

  const repoEmail = runGitSafe(['config', 'user.email'], '');
  const globalEmail = runGitSafe(['config', '--global', 'user.email'], '');
  const repoEmailType = classifyEmail(repoEmail);
  const globalEmailType = classifyEmail(globalEmail);

  checks.push(createCheck(
    'git.identity.repoEmail',
    repoEmailType === 'noreply',
    `Repo email: ${repoEmail || '(empty)'}`,
    'Set repo email to GitHub noreply: git config user.email "<id+user@users.noreply.github.com>".'
  ));

  checks.push(createCheck(
    'git.identity.globalEmail',
    globalEmailType === 'noreply',
    `Global email: ${globalEmail || '(empty)'}`,
    'Set global email to GitHub noreply: git config --global user.email "<id+user@users.noreply.github.com>".'
  ));

  const porcelain = runGit(['status', '--porcelain']);
  const clean = porcelain.length === 0;
  const cleanSeverity = args.strict ? 'error' : 'warn';
  checks.push(createCheck(
    'git.cleanWorktree',
    args.allowDirty ? true : clean,
    clean ? 'Git worktree is clean.' : 'Git worktree has uncommitted changes.',
    args.allowDirty ? 'Dirty worktree allowed by --allow-dirty.' : 'Commit/stash changes before running rewrite execution steps.',
    clean ? 'info' : cleanSeverity
  ));

  return checks;
}

function evaluateToolChecks(args) {
  const checks = [];
  const filterRepoAvailable = commandAvailable('git-filter-repo', ['--help']);
  const filterRepoSeverity = args.strict ? 'error' : 'warn';

  checks.push(createCheck(
    'tool.gitFilterRepo',
    filterRepoAvailable,
    filterRepoAvailable ? 'git-filter-repo is available.' : 'git-filter-repo is missing.',
    'Install git-filter-repo before history rewrite.',
    filterRepoAvailable ? 'info' : filterRepoSeverity
  ));

  if (args.requireGitleaks) {
    checks.push(createCheck(
      'tool.gitleaks',
      commandAvailable('gitleaks', ['version']),
      commandAvailable('gitleaks', ['version']) ? 'gitleaks is available.' : 'gitleaks is missing.',
      'Install gitleaks for post-rewrite validation.'
    ));
  } else {
    const present = commandAvailable('gitleaks', ['version']);
    checks.push(createCheck(
      'tool.gitleaks.optional',
      present,
      present ? 'gitleaks is available.' : 'gitleaks not found (optional).',
      'Use --require-gitleaks to enforce this check.',
      present ? 'info' : 'warn'
    ));
  }

  return checks;
}

function evaluateWorkkitChecks(workkitDir) {
  const checks = [];
  if (!workkitDir) return checks;

  const resolved = path.resolve(workkitDir);
  const exists = fs.existsSync(resolved);

  checks.push(createCheck(
    'workkit.dir',
    exists,
    exists ? `Workkit directory found: ${resolved}` : `Workkit directory not found: ${resolved}`,
    'Generate it first: npm run prep:history-rewrite -- --out-dir <dir>.'
  ));

  if (!exists) return checks;

  const requiredFiles = [
    'history-authors.json',
    'history-authors.md',
    'mailmap.private.txt',
    'paths-to-remove.txt',
    'run-filter-repo.sh',
    'history-rewrite-runbook.md'
  ];

  for (const fileName of requiredFiles) {
    const fullPath = path.join(resolved, fileName);
    const fileExists = fs.existsSync(fullPath);
    checks.push(createCheck(
      `workkit.file.${fileName}`,
      fileExists,
      fileExists ? `Found ${fileName}.` : `Missing ${fileName}.`,
      `Re-generate workkit: npm run prep:history-rewrite -- --out-dir ${resolved}.`
    ));
  }

  const mailmapPath = path.join(resolved, 'mailmap.private.txt');
  if (fs.existsSync(mailmapPath)) {
    const mailmapContent = fs.readFileSync(mailmapPath, 'utf8');
    const hasPlaceholder = mailmapContent.includes('REPLACE_WITH_NOREPLY_EMAIL');
    checks.push(createCheck(
      'workkit.mailmap.placeholders',
      !hasPlaceholder,
      hasPlaceholder ? 'Mailmap still contains placeholder noreply tokens.' : 'Mailmap placeholders are already resolved.',
      'Replace placeholder values before executing rewrite.',
      hasPlaceholder ? 'warn' : 'info'
    ));
  }

  const removePathsPath = path.join(resolved, 'paths-to-remove.txt');
  if (fs.existsSync(removePathsPath)) {
    const content = fs.readFileSync(removePathsPath, 'utf8');
    const entries = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    checks.push(createCheck(
      'workkit.removePaths.nonEmpty',
      entries.length > 0,
      `Removal-path entries: ${entries.length}`,
      'Add at least one path to remove from history.'
    ));
  }

  return checks;
}

function summarize(checks) {
  const failingBySeverity = checks.reduce((accumulator, check) => {
    if (check.ok) return accumulator;
    const key = check.severity || 'error';
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const failingErrors = checks.filter((check) => !check.ok && check.severity === 'error');
  const failingWarns = checks.filter((check) => !check.ok && check.severity === 'warn');

  return {
    ok: failingErrors.length === 0,
    totals: {
      checks: checks.length,
      failingErrors: Number(failingBySeverity.error || 0),
      failingWarns: Number(failingBySeverity.warn || 0),
      failingInfos: Number(failingBySeverity.info || 0)
    },
    failingErrors,
    failingWarns
  };
}

function printHuman(checks, summary) {
  const statusLabel = summary.ok ? 'PASS' : 'FAIL';
  process.stdout.write(`History rewrite readiness: ${statusLabel}\n`);
  process.stdout.write(`Checks: ${summary.totals.checks} | failing-error: ${summary.totals.failingErrors} | failing-warn: ${summary.totals.failingWarns} | failing-info: ${summary.totals.failingInfos}\n`);

  for (const check of checks) {
    const icon = check.ok ? 'ok' : (check.severity === 'warn' ? 'warn' : 'fail');
    process.stdout.write(`- [${icon}] ${check.id} :: ${check.detail}\n`);
    if (!check.ok && check.hint) {
      process.stdout.write(`  hint: ${check.hint}\n`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);

  const checks = [
    ...evaluateRepoChecks(args),
    ...evaluateToolChecks(args),
    ...evaluateWorkkitChecks(args.workkitDir)
  ];

  const summary = summarize(checks);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ summary, checks }, null, 2)}\n`);
  } else {
    printHuman(checks, summary);
  }

  process.exitCode = summary.ok ? 0 : 1;
}

main();
