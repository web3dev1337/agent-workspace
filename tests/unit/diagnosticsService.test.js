const { EventEmitter } = require('events');
const { Readable } = require('stream');

describe('diagnosticsService platform smoke', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function fakeSpawn(command, args) {
    const child = new EventEmitter();
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {};

    const cmd = String(command || '');
    const argv = Array.isArray(args) ? args.map(String) : [];

    // Resolve .cmd wrappers through cmd.exe
    let resolvedCmd = cmd;
    if (cmd === 'cmd.exe' && argv[0] === '/d' && argv[1] === '/c') {
      resolvedCmd = argv[2] || '';
    }

    process.nextTick(() => {
      if (resolvedCmd === process.execPath || resolvedCmd === 'node') {
        stdout.push('v22.0.0\n'); stdout.push(null); stderr.push(null);
        child.emit('close', 0);
      } else if (resolvedCmd === 'npm' || resolvedCmd === 'npm.cmd') {
        stdout.push('10.0.0\n'); stdout.push(null); stderr.push(null);
        child.emit('close', 0);
      } else if (resolvedCmd === 'git' || resolvedCmd === 'git.exe') {
        if (argv.includes('user.name')) {
          stdout.push('Test User\n'); stdout.push(null); stderr.push(null);
          child.emit('close', 0);
        } else if (argv.includes('user.email')) {
          stdout.push('test@example.com\n'); stdout.push(null); stderr.push(null);
          child.emit('close', 0);
        } else {
          stdout.push('git version 2.44.0\n'); stdout.push(null); stderr.push(null);
          child.emit('close', 0);
        }
      } else if (resolvedCmd === 'gh' && argv.includes('--version')) {
        stdout.push('gh version 2.61.0\n'); stdout.push(null); stderr.push(null);
        child.emit('close', 0);
      } else if (resolvedCmd === 'gh' && argv.includes('auth')) {
        stdout.push(null); stderr.push('not logged in\n'); stderr.push(null);
        child.emit('close', 1);
      } else if (resolvedCmd === 'claude' || resolvedCmd === 'claude.cmd') {
        stdout.push(null); stderr.push(null);
        child.emit('error', Object.assign(new Error('missing command: claude'), { code: 'ENOENT' }));
      } else if (resolvedCmd === 'codex' || resolvedCmd === 'codex.cmd') {
        stdout.push(null); stderr.push(null);
        child.emit('error', Object.assign(new Error('missing command: codex'), { code: 'ENOENT' }));
      } else if (resolvedCmd === 'bash' || resolvedCmd === 'bash.exe' || resolvedCmd === 'powershell.exe') {
        stdout.push('shell ok\n'); stdout.push(null); stderr.push(null);
        child.emit('close', 0);
      } else if (resolvedCmd === 'ffmpeg') {
        stdout.push(null); stderr.push(null);
        child.emit('error', Object.assign(new Error('missing command: ffmpeg'), { code: 'ENOENT' }));
      } else if (resolvedCmd === 'wsl.exe') {
        stdout.push(null); stderr.push(null);
        child.emit('error', Object.assign(new Error('missing command: wsl.exe'), { code: 'ENOENT' }));
      } else {
        stdout.push(null); stderr.push(null);
        child.emit('error', Object.assign(new Error(`missing command: ${resolvedCmd}`), { code: 'ENOENT' }));
      }
    });

    return child;
  }

  const mockChildProcess = () => {
    jest.doMock('child_process', () => ({
      spawn: fakeSpawn,
      execFile: (command, args, options, callback) => {
        // Legacy fallback for any code still using execFile
        const cmd = String(command || '');
        if (cmd === process.execPath || cmd === 'node') return callback(null, 'v22.0.0\n', '');
        if (cmd === 'npm' || cmd === 'npm.cmd') return callback(null, '10.0.0\n', '');
        if (cmd === 'git') return callback(null, 'git version 2.44.0\n', '');
        if (cmd === 'gh') return callback(null, 'gh version 2.61.0\n', '');
        if (cmd === 'bash' || cmd === 'bash.exe' || cmd === 'powershell.exe') return callback(null, 'shell ok\n', '');
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
    expect(checkIds.has('agent-workspace-home')).toBe(true);
    expect(checkIds.has('gh-auth')).toBe(true);

    const actionIds = new Set((data.repairActions || []).map((a) => a.id));
    expect(actionIds.has('ensure-agent-workspace-home')).toBe(true);
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
      const result1 = await runFirstRunRepair({ action: 'ensure-agent-workspace-home', homeDir: tmpHome });
      expect(result1.ok).toBe(true);
      expect(fs.existsSync(path.join(tmpHome, '.agent-workspace'))).toBe(true);

      const result2 = await runFirstRunRepair({ action: 'ensure-workspaces-dir', homeDir: tmpHome });
      expect(result2.ok).toBe(true);
      expect(fs.existsSync(path.join(tmpHome, '.agent-workspace', 'workspaces'))).toBe(true);

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
    expect(fs.existsSync(path.join(tmpHome, '.agent-workspace'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.agent-workspace', 'workspaces'))).toBe(true);
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
