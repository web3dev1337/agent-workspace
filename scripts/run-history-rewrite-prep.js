#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    outDir: '',
    reportDir: '',
    strict: false,
    json: false,
    applyTools: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--out' || token === '--out-dir') && next) {
      args.outDir = next;
      index += 1;
      continue;
    }

    if ((token === '--report-dir' || token === '--reports') && next) {
      args.reportDir = next;
      index += 1;
      continue;
    }

    if (token === '--strict') {
      args.strict = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--apply-tools') {
      args.applyTools = true;
    }
  }

  return args;
}

function defaultOutDir() {
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  return path.join(os.tmpdir(), `history-rewrite-workkit-${stamp}`);
}

function runNodeScript(scriptPath, scriptArgs) {
  const result = spawnSync('node', [scriptPath, ...scriptArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# History rewrite prep pipeline report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Out dir: ${report.outDir}`);
  lines.push(`Strict mode: ${report.strict ? 'yes' : 'no'}`);
  lines.push(`Success: ${report.success ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  for (const step of report.steps) {
    lines.push(`- ${step.id}: ${step.ok ? 'ok' : 'fail'} (exit ${step.status})`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeReports(report, reportDir) {
  const resolved = path.resolve(reportDir);
  ensureDir(resolved);

  fs.writeFileSync(path.join(resolved, 'prep-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(resolved, 'prep-report.md'), buildMarkdownReport(report));

  for (const step of report.steps) {
    const fileName = `${step.id}.json`;
    fs.writeFileSync(path.join(resolved, fileName), `${JSON.stringify({
      id: step.id,
      ok: step.ok,
      status: step.status,
      enforced: step.enforced || false,
      stdout: step.stdout,
      stderr: step.stderr
    }, null, 2)}\n`);
  }

  return resolved;
}

function toRelativeScript(repoRoot, scriptFileName) {
  return path.join(repoRoot, 'scripts', scriptFileName);
}

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required script not found: ${filePath}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const outDir = path.resolve(args.outDir || defaultOutDir());

  const scripts = {
    setupTools: toRelativeScript(repoRoot, 'setup-history-rewrite-tools.js'),
    prepareWorkkit: toRelativeScript(repoRoot, 'generate-history-rewrite-workkit.js'),
    checkReadiness: toRelativeScript(repoRoot, 'check-history-rewrite-readiness.js')
  };

  Object.values(scripts).forEach(assertExists);

  const report = {
    generatedAt: new Date().toISOString(),
    outDir,
    reportDir: '',
    strict: args.strict,
    steps: []
  };

  const setupArgs = ['--json'];
  if (args.applyTools) setupArgs.unshift('--apply');
  const setupResult = runNodeScript(scripts.setupTools, setupArgs);
  const setupEnforced = args.strict || args.applyTools;
  report.steps.push({
    id: 'setup-tools',
    ok: setupResult.status === 0 || !setupEnforced,
    enforced: setupEnforced,
    status: setupResult.status,
    stdout: setupResult.stdout,
    stderr: setupResult.stderr
  });

  const workkitResult = runNodeScript(scripts.prepareWorkkit, ['--out-dir', outDir]);
  report.steps.push({
    id: 'prepare-workkit',
    ok: workkitResult.status === 0,
    status: workkitResult.status,
    stdout: workkitResult.stdout,
    stderr: workkitResult.stderr
  });

  const readinessArgs = ['--workkit-dir', outDir, '--json'];
  if (args.strict) {
    readinessArgs.unshift('--strict', '--require-gitleaks');
  }
  const readinessResult = runNodeScript(scripts.checkReadiness, readinessArgs);
  report.steps.push({
    id: 'readiness-check',
    ok: readinessResult.status === 0,
    status: readinessResult.status,
    stdout: readinessResult.stdout,
    stderr: readinessResult.stderr
  });

  const success = report.steps.every((step) => step.ok);
  report.success = success;

  if (args.reportDir) {
    const resolvedReportDir = path.resolve(args.reportDir);
    report.reportDir = resolvedReportDir;
    writeReports(report, resolvedReportDir);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write('History rewrite prep pipeline\n');
    process.stdout.write(`- outDir: ${outDir}\n`);
    if (report.reportDir) process.stdout.write(`- reportDir: ${report.reportDir}\n`);
    for (const step of report.steps) {
      process.stdout.write(`- ${step.id}: ${step.ok ? 'ok' : 'fail'} (exit ${step.status})\n`);
      const firstLine = step.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
      if (firstLine) process.stdout.write(`  ${firstLine}\n`);
    }
  }

  process.exitCode = success ? 0 : 1;
}

main();
