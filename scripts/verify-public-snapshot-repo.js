#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    snapshotDir: '/home/<user>/GitHub/tools/automation/agent-workspace/agent-workspace-public-snapshot',
    json: false,
    enforceSingleCommit: true
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--snapshot-dir' || token === '--snapshot') && next) {
      args.snapshotDir = next;
      index += 1;
      continue;
    }

    if (token === '--allow-multi-commit') {
      args.enforceSingleCommit = false;
      continue;
    }

    if (token === '--json') {
      args.json = true;
    }
  }

  return args;
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function checkSnapshot(snapshotDir, enforceSingleCommit) {
  const checks = [];
  const resolved = path.resolve(snapshotDir);

  const exists = fs.existsSync(resolved);
  checks.push({
    id: 'snapshot.exists',
    ok: exists,
    severity: 'error',
    detail: `snapshot directory ${exists ? 'exists' : 'missing'}: ${resolved}`
  });

  if (!exists) {
    return { snapshotDir: resolved, checks, commitCount: 0, headCommit: '', ready: false };
  }

  const hasGit = fs.existsSync(path.join(resolved, '.git'));
  checks.push({
    id: 'snapshot.git',
    ok: hasGit,
    severity: 'error',
    detail: hasGit ? '.git found' : '.git missing'
  });

  const hasPackageJson = fs.existsSync(path.join(resolved, 'package.json'));
  checks.push({
    id: 'snapshot.packageJson',
    ok: hasPackageJson,
    severity: 'error',
    detail: hasPackageJson ? 'package.json found' : 'package.json missing'
  });

  let commitCount = 0;
  let headCommit = '';

  if (hasGit) {
    const count = run('git', ['rev-list', '--count', 'HEAD'], { cwd: resolved });
    if (count.status === 0) {
      commitCount = Number(String(count.stdout || '').trim() || 0);
    }

    const head = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: resolved });
    if (head.status === 0) {
      headCommit = String(head.stdout || '').trim();
    }

    checks.push({
      id: 'snapshot.commitCount',
      ok: enforceSingleCommit ? commitCount === 1 : commitCount >= 1,
      severity: 'error',
      detail: `commit count: ${commitCount}`
    });

    checks.push({
      id: 'snapshot.head',
      ok: Boolean(headCommit),
      severity: 'error',
      detail: `head commit: ${headCommit || '(none)'}`
    });
  }

  const audit = run('node', ['scripts/public-release-audit.js'], { cwd: resolved });
  checks.push({
    id: 'snapshot.publicReleaseAudit',
    ok: audit.status === 0,
    severity: 'error',
    detail: `public-release-audit exit: ${audit.status}`,
    stdout: String(audit.stdout || ''),
    stderr: String(audit.stderr || '')
  });

  const ready = checks.every((check) => check.ok || check.severity !== 'error');
  return { snapshotDir: resolved, checks, commitCount, headCommit, ready };
}

function printHuman(report) {
  process.stdout.write(`Public snapshot verification: ${report.ready ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`- snapshotDir: ${report.snapshotDir}\n`);
  process.stdout.write(`- commitCount: ${report.commitCount}\n`);
  process.stdout.write(`- headCommit: ${report.headCommit || '(none)'}\n`);

  for (const check of report.checks) {
    process.stdout.write(`- [${check.ok ? 'ok' : 'fail'}] ${check.id} :: ${check.detail}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const report = checkSnapshot(args.snapshotDir, args.enforceSingleCommit);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }

  process.exitCode = report.ready ? 0 : 1;
}

main();
