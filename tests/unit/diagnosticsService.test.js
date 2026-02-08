describe('diagnosticsService platform smoke', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const mockChildProcess = () => {
    jest.doMock('child_process', () => ({
      execFile: (command, args, options, callback) => {
        const cmd = String(command || '');
        const argv = Array.isArray(args) ? args.map(String) : [];
        if (cmd === process.execPath || cmd === 'node') return callback(null, 'v22.0.0\n', '');
        if (cmd === 'npm' || cmd === 'npm.cmd') return callback(null, '10.0.0\n', '');
        if (cmd === 'git') return callback(null, 'git version 2.44.0\n', '');
        if (cmd === 'gh' && argv[0] === '--version') return callback(null, 'gh version 2.61.0\n', '');
        if (cmd === 'gh' && argv[0] === 'auth') {
          const err = new Error('not logged in');
          err.code = 1;
          return callback(err, '', 'not logged in');
        }
        if (cmd === 'claude') {
          const err = new Error('missing command: claude');
          err.code = 'ENOENT';
          return callback(err, '', '');
        }
        if (cmd === 'codex') {
          const err = new Error('missing command: codex');
          err.code = 'ENOENT';
          return callback(err, '', '');
        }
        if (cmd === 'bash' || cmd === 'bash.exe' || cmd === 'powershell.exe') {
          return callback(null, 'shell ok\n', '');
        }
        const err = new Error(`missing command: ${cmd}`);
        err.code = 'ENOENT';
        return callback(err, '', '');
      }
    }));
  };

  test('collectDiagnostics returns platformSmoke checks', async () => {
    mockChildProcess();

    const { collectDiagnostics } = require('../../server/diagnosticsService');
    const data = await collectDiagnostics();

    expect(data).toBeTruthy();
    expect(data.platformSmoke).toBeTruthy();
    expect(data.platformSmoke.checks).toBeTruthy();
    expect(data.platformSmoke.checks.shell.id).toBe(process.platform === 'win32' ? 'powershell' : 'bash');
    expect(data.platformSmoke.checks.shell.ok).toBe(true);
    expect(data.platformSmoke.checks.git.ok).toBe(true);
    expect(data.platformSmoke.checks.gh.ok).toBe(true);
    expect(data.platformSmoke.checks.ghAuth.ok).toBe(false);
    expect(typeof data.platformSmoke.ok).toBe('boolean');
  });

  test('collectFirstRunDiagnostics returns actionable checks and repairs', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-home-'));
    mockChildProcess();

    const { collectFirstRunDiagnostics } = require('../../server/diagnosticsService');
    const data = await collectFirstRunDiagnostics({ homeDir: tmpHome });

    expect(data).toBeTruthy();
    expect(data.summary).toBeTruthy();
    expect(Array.isArray(data.checks)).toBe(true);
    expect(data.checks.length).toBeGreaterThan(5);

    const checkIds = new Set(data.checks.map((c) => c.id));
    expect(checkIds.has('node-pty-loaded')).toBe(true);
    expect(checkIds.has('orchestrator-home')).toBe(true);
    expect(checkIds.has('gh-auth')).toBe(true);

    const actionIds = new Set((data.repairActions || []).map((a) => a.id));
    expect(actionIds.has('ensure-orchestrator-home')).toBe(true);
    expect(actionIds.has('ensure-workspaces-dir')).toBe(true);
    expect(actionIds.has('gh-auth-login')).toBe(true);
  });

  test('runFirstRunRepair creates expected directories and supports manual actions', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-home-repair-'));
    const oldHome = process.env.HOME;
    process.env.HOME = tmpHome;

    mockChildProcess();
    const { runFirstRunRepair } = require('../../server/diagnosticsService');

    try {
      const result1 = await runFirstRunRepair({ action: 'ensure-orchestrator-home', homeDir: tmpHome });
      expect(result1.ok).toBe(true);
      expect(fs.existsSync(path.join(tmpHome, '.orchestrator'))).toBe(true);

      const result2 = await runFirstRunRepair({ action: 'ensure-workspaces-dir', homeDir: tmpHome });
      expect(result2.ok).toBe(true);
      expect(fs.existsSync(path.join(tmpHome, '.orchestrator', 'workspaces'))).toBe(true);

      const manual = await runFirstRunRepair({ action: 'gh-auth-login', homeDir: tmpHome });
      expect(manual.ok).toBe(false);
      expect(manual.manual).toBe(true);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });

  test('runFirstRunSafeRepairs runs safe actions and skips manual ones', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-home-safe-repair-'));
    mockChildProcess();
    const { runFirstRunSafeRepairs } = require('../../server/diagnosticsService');

    const result = await runFirstRunSafeRepairs({ homeDir: tmpHome });

    expect(result).toBeTruthy();
    expect(typeof result.attemptedCount).toBe('number');
    expect(result.attemptedCount).toBeGreaterThan(0);
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(Array.isArray(result.results)).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.orchestrator'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.orchestrator', 'workspaces'))).toBe(true);
    expect(result.skippedManualCount).toBeGreaterThan(0);
    expect(result.diagnostics?.summary).toBeTruthy();
  });

  test('collectInstallWizard returns guided post-install steps with actions', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-home-install-wizard-'));
    mockChildProcess();
    const { collectInstallWizard } = require('../../server/diagnosticsService');

    const data = await collectInstallWizard({ homeDir: tmpHome });
    expect(data).toBeTruthy();
    expect(data.summary).toBeTruthy();
    expect(Array.isArray(data.steps)).toBe(true);
    expect(data.steps.length).toBeGreaterThan(5);
    expect(Array.isArray(data.actionable)).toBe(true);
    expect(Array.isArray(data.guidance)).toBe(true);

    const stepIds = new Set(data.steps.map((step) => step.id));
    expect(stepIds.has('git-installed')).toBe(true);
    expect(stepIds.has('gh-auth')).toBe(true);
    expect(stepIds.has('node-pty-loaded')).toBe(true);

    const ghAuth = data.steps.find((step) => step.id === 'gh-auth');
    expect(ghAuth).toBeTruthy();
    expect(String(ghAuth.command || '')).toContain('gh auth login');
  });
});
