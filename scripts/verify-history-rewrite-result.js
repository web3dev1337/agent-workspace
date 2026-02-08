#!/usr/bin/env node

const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    advisory: false,
    json: false,
    allowCustomEmails: false,
    extraBlockedPaths: []
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if (token === '--advisory') {
      args.advisory = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--allow-custom-emails') {
      args.allowCustomEmails = true;
      continue;
    }

    if ((token === '--blocked-path' || token === '--add-blocked-path') && next) {
      args.extraBlockedPaths.push(next);
      index += 1;
    }
  }

  return args;
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function classifyEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return 'empty';
  if (value.endsWith('@users.noreply.github.com')) return 'noreply';
  if (value.endsWith('@example.com') || value.endsWith('@example.org') || value.endsWith('@example.net')) return 'example';
  if (value.includes('localhost') || value.includes('localdomain')) return 'local';
  return 'custom';
}

function buildEmailSummary() {
  const output = runGit(['log', '--all', '--format=%aE%n%cE']);
  const emails = output
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);

  const unique = Array.from(new Set(emails)).sort((a, b) => a.localeCompare(b));
  const byType = unique.reduce((acc, email) => {
    const type = classifyEmail(email);
    acc[type] = acc[type] || [];
    acc[type].push(email);
    return acc;
  }, {});

  return {
    uniqueEmails: unique,
    byType,
    totals: {
      unique: unique.length,
      noreply: (byType.noreply || []).length,
      custom: (byType.custom || []).length,
      example: (byType.example || []).length,
      local: (byType.local || []).length,
      empty: (byType.empty || []).length
    }
  };
}

function buildPathSummary(blockedPaths) {
  const output = runGit(['log', '--all', '--name-only', '--pretty=format:']);
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set(lines);
  const matches = [];

  for (const blocked of blockedPaths) {
    const normalizedBlocked = String(blocked || '').trim();
    if (!normalizedBlocked) continue;
    const hit = Array.from(seen).filter((entry) => entry === normalizedBlocked || entry.startsWith(`${normalizedBlocked}/`));
    if (hit.length) {
      matches.push({ blocked: normalizedBlocked, hits: hit.slice(0, 20) });
    }
  }

  return { matches };
}

function evaluateChecks(args, emailSummary, pathSummary) {
  const checks = [];
  const defaultErrorSeverity = args.advisory ? 'warn' : 'error';

  const customCount = emailSummary.totals.custom;
  checks.push({
    id: 'emails.custom.none',
    ok: args.allowCustomEmails ? true : customCount === 0,
    severity: args.allowCustomEmails ? 'warn' : defaultErrorSeverity,
    detail: `Custom emails: ${customCount}`,
    hint: 'Rewrite remaining custom author/committer emails to noreply in mailmap/filter-repo pass.'
  });

  checks.push({
    id: 'emails.noreply.present',
    ok: emailSummary.totals.noreply > 0,
    severity: 'warn',
    detail: `Noreply emails: ${emailSummary.totals.noreply}`,
    hint: 'Expected noreply identities after rewrite.'
  });

  checks.push({
    id: 'paths.blocked.removed',
    ok: pathSummary.matches.length === 0,
    severity: defaultErrorSeverity,
    detail: `Blocked-path matches: ${pathSummary.matches.length}`,
    hint: 'Re-run filter-repo removal pass for blocked history paths.'
  });

  return checks;
}

function summarize(checks, advisory) {
  const failingErrors = checks.filter((check) => !check.ok && check.severity === 'error');
  const failingWarns = checks.filter((check) => !check.ok && check.severity === 'warn');

  return {
    ok: advisory ? failingErrors.length === 0 : failingErrors.length === 0 && failingWarns.length === 0,
    failingErrors,
    failingWarns
  };
}

function printHuman(report) {
  process.stdout.write(`History rewrite result verification: ${report.summary.ok ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`Mode: ${report.options.advisory ? 'advisory' : 'strict'}\n`);
  process.stdout.write(`Unique emails: ${report.emailSummary.totals.unique} (noreply ${report.emailSummary.totals.noreply}, custom ${report.emailSummary.totals.custom})\n`);
  process.stdout.write(`Blocked path matches: ${report.pathSummary.matches.length}\n`);

  for (const check of report.checks) {
    const state = check.ok ? 'ok' : (check.severity === 'warn' ? 'warn' : 'fail');
    process.stdout.write(`- [${state}] ${check.id} :: ${check.detail}\n`);
    if (!check.ok) {
      process.stdout.write(`  hint: ${check.hint}\n`);
    }
  }

  if (report.pathSummary.matches.length) {
    process.stdout.write('Blocked path hits:\n');
    for (const match of report.pathSummary.matches) {
      process.stdout.write(`- ${match.blocked}\n`);
      for (const hit of match.hits) {
        process.stdout.write(`  - ${hit}\n`);
      }
    }
  }

  if (report.emailSummary.byType.custom && report.emailSummary.byType.custom.length) {
    process.stdout.write('Custom emails:\n');
    for (const email of report.emailSummary.byType.custom) {
      process.stdout.write(`- ${email}\n`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const blockedPaths = [
    'diff-viewer/cache',
    'test-results/.last-run.json',
    'config.json.pre-workspace-backup',
    ...args.extraBlockedPaths
  ];

  const emailSummary = buildEmailSummary();
  const pathSummary = buildPathSummary(blockedPaths);
  const checks = evaluateChecks(args, emailSummary, pathSummary);
  const summary = summarize(checks, args.advisory);

  const report = {
    generatedAt: new Date().toISOString(),
    options: {
      advisory: args.advisory,
      allowCustomEmails: args.allowCustomEmails,
      blockedPaths
    },
    emailSummary,
    pathSummary,
    checks,
    summary
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }

  process.exitCode = summary.ok ? 0 : 1;
}

main();
