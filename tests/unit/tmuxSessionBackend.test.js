const { TmuxSessionBackend, shellQuote, stripDeviceReports } = require('../../server/utils/tmuxSessionBackend');

const makeBackend = (overrides = {}) => {
  const calls = [];
  const execImpl = overrides.execImpl || jest.fn((cmd, args) => {
    calls.push([cmd, ...args]);
    return '';
  });
  const backend = new TmuxSessionBackend({
    socketName: 'test-sock',
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    execImpl,
    platform: overrides.platform || 'linux',
    baseEnv: overrides.baseEnv || { PATH: '/usr/bin', HOME: '/home/u' }
  });
  return { backend, execImpl, calls };
};

describe('shellQuote', () => {
  test('passes simple tokens through and quotes the rest', () => {
    expect(shellQuote('bash')).toBe('bash');
    expect(shellQuote('/usr/bin/env')).toBe('/usr/bin/env');
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('cd "x" && exec bash')).toBe(`'cd "x" && exec bash'`);
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('stripDeviceReports', () => {
  const ESC = '\x1b';
  test('removes DA1 and DA2 report sequences (the leaked prompt junk)', () => {
    expect(stripDeviceReports(`${ESC}[?1;2c`)).toBe('');
    expect(stripDeviceReports(`${ESC}[>0;276;0c`)).toBe('');
    expect(stripDeviceReports(`${ESC}[?1;2c${ESC}[>0;276;0c`)).toBe('');
    // interleaved with a real keystroke that happened to follow
    expect(stripDeviceReports(`${ESC}[?1;2cls`)).toBe('ls');
  });

  test('leaves ordinary input and other escape sequences untouched', () => {
    expect(stripDeviceReports('ls -la\r')).toBe('ls -la\r');
    expect(stripDeviceReports(`${ESC}[A`)).toBe(`${ESC}[A`);            // arrow up
    expect(stripDeviceReports(`${ESC}[200~pasted${ESC}[201~`)).toBe(`${ESC}[200~pasted${ESC}[201~`);
    // cursor-position and DSR reports are intentionally preserved (apps use them)
    expect(stripDeviceReports(`${ESC}[24;80R`)).toBe(`${ESC}[24;80R`);
    expect(stripDeviceReports(`${ESC}[0n`)).toBe(`${ESC}[0n`);
  });

  test('is a no-op for non-strings and escape-free input', () => {
    expect(stripDeviceReports('hello')).toBe('hello');
    expect(stripDeviceReports(undefined)).toBe(undefined);
    expect(stripDeviceReports(null)).toBe(null);
  });
});

describe('TmuxSessionBackend', () => {
  test('is unavailable on win32 without probing', () => {
    const { backend, execImpl } = makeBackend({ platform: 'win32' });
    expect(backend.isAvailable()).toBe(false);
    expect(execImpl).not.toHaveBeenCalled();
  });

  test('caches the availability probe', () => {
    const { backend, execImpl } = makeBackend();
    expect(backend.isAvailable()).toBe(true);
    expect(backend.isAvailable()).toBe(true);
    expect(execImpl).toHaveBeenCalledTimes(1);
    expect(execImpl.mock.calls[0][1]).toEqual(['-V']);
  });

  test('fails closed when tmux is missing', () => {
    const execImpl = jest.fn(() => { throw new Error('ENOENT'); });
    const { backend } = makeBackend({ execImpl });
    expect(backend.isAvailable()).toBe(false);
  });

  test('scrubs nested-session markers from every tmux invocation', () => {
    const execImpl = jest.fn(() => '');
    const { backend } = makeBackend({
      execImpl,
      baseEnv: { PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', TMUX: '/tmp/x,1,0', TMUX_PANE: '%1' }
    });
    backend.run(['list-sessions']);
    const env = execImpl.mock.calls[0][2].env;
    expect(env.PATH).toBe('/usr/bin');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
  });

  test('buildSpawnCommand produces an attach-or-create client argv with quoted shell command', () => {
    const { backend } = makeBackend();
    const spec = backend.buildSpawnCommand({
      sessionId: 'zoo-game-work1-claude',
      command: 'bash',
      args: ['-c', 'cd "/tmp/w t" && exec bash'],
      cwd: '/tmp/w t'
    });
    expect(spec.command).toBe('tmux');
    expect(spec.name).toBe('zoo-game-work1-claude');
    expect(spec.args).toEqual([
      '-L', 'test-sock',
      'new-session', '-A', '-s', 'zoo-game-work1-claude',
      '-c', '/tmp/w t',
      `bash -c 'cd "/tmp/w t" && exec bash'`
    ]);
  });

  test('sanitizes session names that would break tmux targets', () => {
    const { backend } = makeBackend();
    expect(backend.sessionName('repo.name:work1-claude')).toBe('repo_name_work1-claude');
    expect(backend.target('repo.name')).toBe('=repo_name');
  });

  test('ensureConfigured starts the server, applies options, and tolerates option failures', () => {
    const seen = [];
    const execImpl = jest.fn((cmd, args) => {
      seen.push(args.slice(2)); // drop -L <socket>
      if (args.includes('set-environment')) throw new Error('unknown variable');
      return '';
    });
    const { backend } = makeBackend({ execImpl });
    expect(backend.ensureConfigured()).toBe(true);
    expect(seen[0]).toEqual(['start-server']);
    expect(seen).toEqual(expect.arrayContaining([
      ['set', '-g', 'status', 'off'],
      ['set', '-g', 'prefix', 'None'],
      ['set', '-g', 'mouse', 'off'],
      ['set', '-g', 'window-size', 'latest'],
      ['set', '-ga', 'terminal-features', 'xterm-256color:RGB:clipboard']
    ]));
    // second call is a no-op
    const callsBefore = execImpl.mock.calls.length;
    expect(backend.ensureConfigured()).toBe(true);
    expect(execImpl.mock.calls.length).toBe(callsBefore);
  });

  test('hasSession / killSession / panePid / capturePane use exact-match targets and fail soft', () => {
    const responses = {
      'has-session': () => '',
      'kill-session': () => '',
      'list-panes': () => '12345\n',
      'capture-pane': () => 'line1\nline2\n',
      'list-sessions': () => 'a-claude\nb-server\n'
    };
    const execImpl = jest.fn((cmd, args) => {
      const sub = args[2];
      if (!responses[sub]) throw new Error(`unexpected ${sub}`);
      return responses[sub]();
    });
    const { backend } = makeBackend({ execImpl });

    expect(backend.hasSession('a-claude')).toBe(true);
    expect(execImpl.mock.calls[0][1]).toEqual(['-L', 'test-sock', 'has-session', '-t', '=a-claude']);

    expect(backend.killSession('a-claude')).toBe(true);
    expect(backend.panePid('a-claude')).toBe(12345);
    expect(backend.capturePane('a-claude', 500)).toBe('line1\nline2\n');
    expect(execImpl.mock.calls.at(-1)[1]).toEqual(
      ['-L', 'test-sock', 'capture-pane', '-p', '-e', '-J', '-t', '=a-claude', '-S', '-500']
    );
    expect(backend.listSessionNames()).toEqual(['a-claude', 'b-server']);

    // failures degrade to safe defaults instead of throwing
    const failing = makeBackend({ execImpl: jest.fn(() => { throw new Error('no server'); }) }).backend;
    expect(failing.hasSession('x')).toBe(false);
    expect(failing.killSession('x')).toBe(false);
    expect(failing.panePid('x')).toBeNull();
    expect(failing.capturePane('x')).toBe('');
    expect(failing.listSessionNames()).toEqual([]);
  });
});
