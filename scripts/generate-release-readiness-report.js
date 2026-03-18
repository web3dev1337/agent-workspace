#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    includeHistory: false,
    jsonOut: '',
    mdOut: '',
    snapshotDir: '',
    json: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--json-out' || token === '--json') && next && token !== '--json') {
      args.jsonOut = next;
      index += 1;
      continue;
    }

    if ((token === '--md-out' || token === '--markdown-out') && next) {
      args.mdOut = next;
      index += 1;
      continue;
    }

    if ((token === '--snapshot-dir' || token === '--snapshot') && next) {
      args.snapshotDir = next;
      index += 1;
      continue;
    }

    if (token === '--no-history') {
      args.includeHistory = false;
      continue;
    }

    if (token === '--include-history') {
      args.includeHistory = true;
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

function ensureParent(filePath) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

function runNodeScript(repoRoot, scriptRelPath, scriptArgs) {
  const result = run('node', [path.join(repoRoot, scriptRelPath), ...scriptArgs], { cwd: repoRoot });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function classifyEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return 'empty';
  if (value.endsWith('@users.noreply.github.com')) return 'noreply';
  if (value.includes('localhost') || value.includes('localdomain')) return 'local';
  if (value.endsWith('@example.com') || value.endsWith('@example.org') || value.endsWith('@example.net')) return 'example';
  return 'custom';
}

function getGitState(repoRoot) {
  const branch = run('git', ['branch', '--show-current'], { cwd: repoRoot });
  const aheadBehind = run('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], { cwd: repoRoot });
  const clean = run('git', ['status', '--porcelain'], { cwd: repoRoot });

  let ahead = 0;
  let behind = 0;
  const tokens = String(aheadBehind.stdout || '').trim().split(/\s+/).map((value) => Number(value));
  if (tokens.length >= 2 && Number.isFinite(tokens[0]) && Number.isFinite(tokens[1])) {
    ahead = tokens[0];
    behind = tokens[1];
  }

  return {
    branch: String(branch.stdout || '').trim(),
    ahead,
    behind,
    clean: String(clean.stdout || '').trim().length === 0
  };
}

function getGitIdentityStatus(repoRoot) {
  const effectiveEmailOut = run('git', ['config', 'user.email'], { cwd: repoRoot });
  const effectiveEmail = String(effectiveEmailOut.stdout || '').trim();
  const globalEmailOut = run('git', ['config', '--global', 'user.email'], { cwd: repoRoot });
  const globalEmail = String(globalEmailOut.stdout || '').trim();

  const effectiveEmailClass = classifyEmail(effectiveEmail);
  const globalEmailClass = classifyEmail(globalEmail);

  return {
    effectiveEmail,
    effectiveEmailClass,
    effectiveIsNoreply: effectiveEmailClass === 'noreply',
    globalEmail,
    globalEmailClass,
    globalIsNoreply: globalEmailClass === 'noreply'
  };
}

function getRemainingWorkStatus(repoRoot) {
  const remainingPath = path.join(repoRoot, 'PLANS/2026-02-08/REMAINING_WORK_NOW.md');
  const content = fs.readFileSync(remainingPath, 'utf8');
  const completeLine = 'None required for the current release-readiness target.';
  return {
    path: remainingPath,
    completeLine,
    isComplete: content.includes(completeLine)
  };
}

function getSnapshotStatus(repoRoot, snapshotDirArg) {
  const defaultDir = '/home/<user>/GitHub/tools/automation/agent-workspace/agent-workspace-public-snapshot';
  const target = path.resolve(snapshotDirArg || defaultDir);
  const exists = fs.existsSync(target);
  let hasGit = false;
  let commit = '';

  if (exists) {
    hasGit = fs.existsSync(path.join(target, '.git'));
    if (hasGit) {
      const head = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: target });
      if (head.status === 0) commit = String(head.stdout || '').trim();
    }
  }

  return { target, exists, hasGit, commit };
}

function getSnapshotVerification(repoRoot, snapshotDirArg) {
  const args = [];
  if (snapshotDirArg) {
    args.push('--snapshot-dir', path.resolve(snapshotDirArg));
  }
  args.push('--json');

  const verify = runNodeScript(repoRoot, 'scripts/verify-public-snapshot-repo.js', args);
  const parsed = parseJsonSafe(verify.stdout);
  return {
    ok: verify.ok,
    status: verify.status,
    parsed
  };
}

function getActionableScanStatus(repoRoot) {
  const scan = runNodeScript(repoRoot, 'scripts/scan-markdown-remaining.js', ['--scope', 'all', '--actionable-only', '--json']);
  const parsed = parseJsonSafe(scan.stdout);
  const summary = parsed && parsed.summary ? parsed.summary : null;
  const withRemaining = summary ? Number(summary.withRemaining || 0) : -1;
  return {
    ok: scan.ok && !!summary,
    status: scan.status,
    withRemaining,
    parsed
  };
}

function getNoWeekEstimateStatus(repoRoot) {
  const targets = [
    'CLAUDE.md',
    'PLANS/2026-02-05/PLUGIN_ARCHITECTURE_AND_PRO_GATING.md',
    'PLANS/2026-02-08/COMPETITIVE_GAP_EXECUTION_PLAN.md',
    'PLANS/2026-02-08/REMAINING_WORK_NOW.md',
    'PLANS/2026-02-09/REMAINING_WORK_LAST_14_DAYS_SYNTHESIS.md'
  ];
  const issues = [];
  const weekEstimateRegex = /\b\d+\s*(?:[–-]\s*\d+\+?)?\s*weeks?\b/i;
  const weekNumberRegex = /\bweek\s*\d+\b/i;

  for (const target of targets) {
    const absolutePath = path.join(repoRoot, target);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (weekEstimateRegex.test(line) || weekNumberRegex.test(line)) {
        issues.push({
          file: target,
          line: index + 1,
          text: line.trim()
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Release readiness report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Ready: ${report.summary.ready ? 'yes' : 'no'}`);
  lines.push(`- Critical failures: ${report.summary.criticalFailures}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push(`- Git clean: ${report.checks.git.clean ? 'yes' : 'no'}`);
  lines.push(`- Ahead/behind origin/main: ${report.checks.git.ahead}/${report.checks.git.behind}`);
  lines.push(`- Effective git email noreply: ${report.checks.gitIdentity.effectiveIsNoreply ? 'yes' : 'no'}`);
  lines.push(`- Global git email noreply: ${report.checks.gitIdentity.globalIsNoreply ? 'yes' : 'no'}`);
  lines.push(`- Remaining-work line present: ${report.checks.remainingWork.isComplete ? 'yes' : 'no'}`);
  lines.push(`- Public release audit: ${report.checks.publicReleaseAudit.ok ? 'pass' : 'fail'}`);
  if (report.checks.publicReleaseHistoryAudit) {
    lines.push(`- Public release history audit: ${report.checks.publicReleaseHistoryAudit.ok ? 'pass' : 'fail'}`);
  }
  lines.push(`- Snapshot repo exists: ${report.checks.snapshot.exists ? 'yes' : 'no'}`);
  if (report.checks.snapshot.exists) {
    lines.push(`- Snapshot commit: ${report.checks.snapshot.commit || '(unknown)'}`);
  }
  lines.push(`- Snapshot verifier: ${report.checks.snapshotVerification.ok ? 'pass' : 'fail'}`);
  if (report.checks.snapshotVerification.parsed) {
    lines.push(`- Snapshot commit count: ${report.checks.snapshotVerification.parsed.commitCount}`);
  }
  lines.push(`- Actionable markdown scan: ${report.checks.actionableScan.ok ? 'pass' : 'fail'}`);
  lines.push(`- Actionable markdown remaining: ${report.checks.actionableScan.withRemaining}`);
  lines.push(`- No week-based estimates in active docs: ${report.checks.noWeekEstimates.ok ? 'pass' : 'fail'}`);
  if (!report.checks.noWeekEstimates.ok) {
    lines.push(`- Week-estimate findings: ${report.checks.noWeekEstimates.issues.length}`);
  }
  lines.push(`- History custom email count (canonical/info): ${report.checks.historyAuthors.customEmails}`);
  lines.push(`- History custom email warning enabled: ${report.checks.historyAuthors.warningEnabled ? 'yes' : 'no'}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();

  const checks = {};
  checks.git = getGitState(repoRoot);
  checks.gitIdentity = getGitIdentityStatus(repoRoot);
  checks.remainingWork = getRemainingWorkStatus(repoRoot);
  checks.snapshot = getSnapshotStatus(repoRoot, args.snapshotDir);
  checks.snapshotVerification = getSnapshotVerification(repoRoot, args.snapshotDir);
  checks.actionableScan = getActionableScanStatus(repoRoot);
  checks.noWeekEstimates = getNoWeekEstimateStatus(repoRoot);

  checks.publicReleaseAudit = runNodeScript(repoRoot, 'scripts/public-release-audit.js', []);
  checks.publicReleaseHistoryAudit = args.includeHistory
    ? runNodeScript(repoRoot, 'scripts/public-release-audit.js', ['--history-secrets'])
    : null;

  const historyAuthorAudit = runNodeScript(repoRoot, 'scripts/audit-history-authors.js', ['--json', '/tmp/release-readiness-history-authors.json']);
  checks.historyAuthors = { ok: historyAuthorAudit.ok, customEmails: -1, warningEnabled: args.includeHistory };
  if (historyAuthorAudit.ok) {
    const parsed = parseJsonSafe(fs.readFileSync('/tmp/release-readiness-history-authors.json', 'utf8'));
    checks.historyAuthors.customEmails = parsed ? Number(parsed.customEmails || 0) : -1;
  }

  const criticalFailures = [
    !checks.remainingWork.isComplete,
    !checks.publicReleaseAudit.ok,
    args.includeHistory && checks.publicReleaseHistoryAudit && !checks.publicReleaseHistoryAudit.ok,
    !checks.snapshot.exists,
    !checks.snapshot.hasGit,
    !checks.snapshotVerification.ok,
    !checks.actionableScan.ok,
    checks.actionableScan.withRemaining > 0,
    !checks.noWeekEstimates.ok
  ].filter(Boolean).length;

  const warnings = [
    !checks.git.clean,
    checks.git.ahead !== 0 || checks.git.behind !== 0,
    !checks.gitIdentity.effectiveIsNoreply,
    !checks.gitIdentity.globalIsNoreply,
    checks.historyAuthors.warningEnabled && checks.historyAuthors.customEmails > 0
  ].filter(Boolean).length;

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      ready: criticalFailures === 0,
      criticalFailures,
      warnings
    },
    checks
  };

  if (args.jsonOut) {
    const outPath = path.resolve(args.jsonOut);
    ensureParent(outPath);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.mdOut) {
    const outPath = path.resolve(args.mdOut);
    ensureParent(outPath);
    fs.writeFileSync(outPath, buildMarkdown(report));
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Release readiness: ${report.summary.ready ? 'READY' : 'NOT_READY'}\n`);
    process.stdout.write(`- critical failures: ${report.summary.criticalFailures}\n`);
    process.stdout.write(`- warnings: ${report.summary.warnings}\n`);
  }

  process.exitCode = report.summary.ready ? 0 : 1;
}

main();
