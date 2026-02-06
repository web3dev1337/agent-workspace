#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { evaluateBindSecurity } = require('../server/networkSecurityPolicy');

const repoRoot = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const runHistorySecrets = args.has('--history-secrets');

const publicDocs = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'WINDOWS_QUICK_START.md',
  'PLANS/2026-02-06/SELLABLE_WINDOWS_RELEASE_PLAYBOOK.md',
  'scripts/windows-launchers/README.md'
];

const genericUsernames = new Set([
  'user',
  'youruser',
  'your_username',
  'yourusername',
  '<user>',
  'username',
  'home'
]);

function runGit(argsList) {
  const stdout = execFileSync('git', argsList, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return String(stdout || '');
}

function hasCommand(command, versionArgs = ['--version']) {
  const probe = spawnSync(command, versionArgs, {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true
  });
  return probe.status === 0;
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[<>]/g, '');
}

function isGenericUsername(raw) {
  const name = normalizeUsername(raw);
  if (!name) return true;
  if (genericUsernames.has(name)) return true;
  if (name.includes('your') || name.includes('user')) return true;
  if (/^[a-z_]+$/.test(name) && (name === 'ab' || name === 'anrokx')) return false;
  return false;
}

function collectPathFindings(filePath, content) {
  const findings = [];
  const homeRegex = /\/home\/([A-Za-z0-9_.-]+)\//g;
  const wslRegex = /\/mnt\/c\/Users\/([^\/]+)\//gi;
  const winRegex = /C:\\Users\\([^\\]+)\\/g;

  const collect = (regex, type) => {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const user = String(match[1] || '').trim();
      if (!isGenericUsername(user)) {
        findings.push({
          type,
          file: filePath,
          value: match[0]
        });
      }
    }
  };

  collect(homeRegex, 'home-path');
  collect(wslRegex, 'wsl-path');
  collect(winRegex, 'windows-path');

  return findings;
}

function checkTrackedArtifacts() {
  const tracked = runGit(['ls-files']).split(/\r?\n/).filter(Boolean);
  const matches = [];
  const banned = [
    { type: 'tracked-cache', re: /^diff-viewer\/cache\//i },
    { type: 'tracked-test-artifact', re: /^test-results\/\.last-run\.json$/i },
    { type: 'tracked-backup', re: /^config\.json\.pre-workspace-backup$/i },
    { type: 'tracked-db', re: /\.(db|sqlite|sqlite3)$/i }
  ];

  for (const file of tracked) {
    for (const rule of banned) {
      if (rule.re.test(file)) {
        matches.push({ type: rule.type, file });
      }
    }
  }
  return matches;
}

function checkPublicDocs() {
  const findings = [];
  for (const relPath of publicDocs) {
    const fullPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    findings.push(...collectPathFindings(relPath, content));
  }
  return findings;
}

function checkNetworkPolicyDefaults() {
  const findings = [];
  const defaultPolicy = evaluateBindSecurity({});
  if (defaultPolicy.host !== '127.0.0.1') {
    findings.push({
      type: 'network-default',
      message: `Default host is not loopback (${defaultPolicy.host})`
    });
  }
  if (!defaultPolicy.allowStart || !defaultPolicy.isLoopback) {
    findings.push({
      type: 'network-default',
      message: 'Default bind policy should allow loopback start only'
    });
  }

  const lanNoAuth = evaluateBindSecurity({
    host: '0.0.0.0',
    authToken: '',
    allowInsecureLanNoAuth: ''
  });
  if (lanNoAuth.allowStart) {
    findings.push({
      type: 'network-lan-auth',
      message: 'LAN binding without auth should be blocked by default'
    });
  }

  const lanWithAuth = evaluateBindSecurity({
    host: '0.0.0.0',
    authToken: 'token',
    allowInsecureLanNoAuth: ''
  });
  if (!lanWithAuth.allowStart) {
    findings.push({
      type: 'network-lan-auth',
      message: 'LAN binding with AUTH_TOKEN should be allowed'
    });
  }

  return findings;
}

function runGitleaksHistory() {
  if (!hasCommand('gitleaks', ['version'])) {
    return [{
      type: 'gitleaks',
      message: 'gitleaks is not installed'
    }];
  }

  const reportPath = path.join('/tmp', 'orchestrator-gitleaks-history.json');
  const result = spawnSync(
    'gitleaks',
    [
      'detect',
      '--source', '.',
      '--log-opts=--all',
      '--redact',
      '--report-format', 'json',
      '--report-path', reportPath
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }
  );

  const reportRaw = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '[]';
  let report = [];
  try {
    report = JSON.parse(reportRaw);
  } catch {
    report = [];
  }

  if (Array.isArray(report) && report.length > 0) {
    return report.slice(0, 10).map((item) => ({
      type: 'gitleaks',
      file: item.File,
      rule: item.RuleID,
      commit: item.Commit
    }));
  }

  if (result.status !== 0 && (!Array.isArray(report) || report.length === 0)) {
    return [{
      type: 'gitleaks',
      message: `gitleaks failed with exit code ${result.status}`
    }];
  }

  return [];
}

function printFindings(title, items) {
  if (!items.length) {
    process.stdout.write(`PASS: ${title}\n`);
    return;
  }
  process.stdout.write(`FAIL: ${title} (${items.length})\n`);
  for (const item of items) {
    const details = Object.entries(item)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ');
    process.stdout.write(`  - ${details}\n`);
  }
}

function main() {
  const artifactFindings = checkTrackedArtifacts();
  const docFindings = checkPublicDocs();
  const networkFindings = checkNetworkPolicyDefaults();
  const gitleaksFindings = runHistorySecrets ? runGitleaksHistory() : [];

  printFindings('No tracked caches/DB artifacts', artifactFindings);
  printFindings('Public docs contain no personal path fingerprints', docFindings);
  printFindings('Loopback/LAN bind auth policy defaults', networkFindings);
  if (runHistorySecrets) {
    printFindings('History secrets scan (gitleaks)', gitleaksFindings);
  } else {
    process.stdout.write('SKIP: History secrets scan (use --history-secrets)\n');
  }

  const total = artifactFindings.length + docFindings.length + networkFindings.length + gitleaksFindings.length;
  if (total > 0) {
    process.exit(1);
  }
  process.stdout.write('PASS: public release audit checks completed\n');
}

main();
