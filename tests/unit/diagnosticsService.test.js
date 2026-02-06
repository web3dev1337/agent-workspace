describe('diagnosticsService platform smoke', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('collectDiagnostics returns platformSmoke checks', async () => {
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
        if (cmd === 'bash' || cmd === 'bash.exe' || cmd === 'powershell.exe') {
          return callback(null, 'shell ok\n', '');
        }
        const err = new Error(`missing command: ${cmd}`);
        err.code = 'ENOENT';
        return callback(err, '', '');
      }
    }));

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
});
