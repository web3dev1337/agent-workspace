const {
  KNOWN_BROKEN_NODE_PTY_VERSION,
  ensureWindowsNodePtyCompat,
  isConnectUsageError,
  isConptyUsageError,
  isStartProcessUsageError,
  loadNodePty,
  wrapConptyCompatMethods,
  wrapConptyConnect,
  wrapConptyStartProcess
} = require('../../server/utils/nodePtyCompat');

describe('nodePtyCompat', () => {
  test('wrapConptyStartProcess preserves the seventh argument when the native binding accepts it', () => {
    const originalStartProcess = jest.fn(() => ({ pty: 123 }));
    const nativeModule = { startProcess: originalStartProcess };

    expect(wrapConptyStartProcess(nativeModule)).toBe(true);

    nativeModule.startProcess('powershell.exe', 120, 40, false, 'pipe-1', true, 'unexpected-extra-flag');

    expect(originalStartProcess).toHaveBeenCalledWith(
      'powershell.exe',
      120,
      40,
      false,
      'pipe-1',
      true,
      'unexpected-extra-flag'
    );
    expect(wrapConptyStartProcess(nativeModule)).toBe(false);
  });

  test('wrapConptyStartProcess retries without the seventh argument on the native usage error', () => {
    const originalStartProcess = jest.fn((...args) => {
      if (args.length >= 7) {
        throw new Error('Usage: pty.startProcess(file, cols, rows, debug, pipeName, inheritCursor)');
      }
      return { pty: 456 };
    });
    const nativeModule = { startProcess: originalStartProcess };

    expect(wrapConptyStartProcess(nativeModule)).toBe(true);

    expect(nativeModule.startProcess('powershell.exe', 120, 40, false, 'pipe-1', true, 'unexpected-extra-flag')).toEqual({ pty: 456 });
    expect(originalStartProcess).toHaveBeenNthCalledWith(
      1,
      'powershell.exe',
      120,
      40,
      false,
      'pipe-1',
      true,
      'unexpected-extra-flag'
    );
    expect(originalStartProcess).toHaveBeenNthCalledWith(
      2,
      'powershell.exe',
      120,
      40,
      false,
      'pipe-1',
      true
    );
  });

  test('wrapConptyConnect retries without useConptyDll on the native usage error', () => {
    const exitCallback = jest.fn();
    const originalConnect = jest.fn((...args) => {
      if (args.length >= 6) {
        throw new Error('Usage: pty.connect(id, cmdline, cwd, env, exitCallback)');
      }
      return { pid: 321 };
    });
    const nativeModule = { connect: originalConnect };

    expect(wrapConptyConnect(nativeModule)).toBe(true);

    expect(nativeModule.connect(7, 'powershell.exe', 'C:\\repo', { PATH: 'x' }, true, exitCallback)).toEqual({ pid: 321 });
    expect(originalConnect).toHaveBeenNthCalledWith(
      1,
      7,
      'powershell.exe',
      'C:\\repo',
      { PATH: 'x' },
      true,
      exitCallback
    );
    expect(originalConnect).toHaveBeenNthCalledWith(
      2,
      7,
      'powershell.exe',
      'C:\\repo',
      { PATH: 'x' },
      exitCallback
    );
  });

  test('wrapConptyCompatMethods adapts trailing boolean compatibility calls', () => {
    const originalResize = jest.fn((...args) => {
      if (args.length === 4) {
        throw new Error('Usage: pty.resize(id, cols, rows)');
      }
      return undefined;
    });
    const originalClear = jest.fn((...args) => {
      if (args.length === 2) {
        throw new Error('Usage: pty.clear(id)');
      }
      return undefined;
    });
    const originalKill = jest.fn((...args) => {
      if (args.length === 2) {
        throw new Error('Usage: pty.kill(id)');
      }
      return undefined;
    });
    const nativeModule = {
      startProcess: jest.fn(() => ({ pty: 1 })),
      connect: jest.fn(() => ({ pid: 2 })),
      resize: originalResize,
      clear: originalClear,
      kill: originalKill
    };

    expect(wrapConptyCompatMethods(nativeModule)).toEqual([
      'startProcess',
      'connect',
      'resize',
      'clear',
      'kill'
    ]);

    nativeModule.resize(1, 120, 40, true);
    nativeModule.clear(1, true);
    nativeModule.kill(1, true);

    expect(originalResize).toHaveBeenCalledTimes(2);
    expect(originalClear).toHaveBeenCalledTimes(2);
    expect(originalKill).toHaveBeenCalledTimes(2);
  });

  test('ensureWindowsNodePtyCompat wraps loadNativeModule for the affected Windows build', () => {
    const originalStartProcess = jest.fn(() => ({ pty: 789 }));
    const originalConnect = jest.fn(() => ({ pid: 456 }));
    const conptyModule = {
      startProcess: originalStartProcess,
      connect: originalConnect,
      resize: jest.fn(),
      clear: jest.fn(),
      kill: jest.fn()
    };
    const originalLoadNativeModule = jest.fn((name) => ({
      dir: `mock/${name}`,
      module: conptyModule
    }));
    const utilsModule = {
      loadNativeModule: originalLoadNativeModule
    };

    const result = ensureWindowsNodePtyCompat({
      platform: 'win32',
      utilsModule,
      packageInfo: { version: KNOWN_BROKEN_NODE_PTY_VERSION }
    });

    expect(result).toEqual({
      applied: true,
      reason: 'patched-load-native-module',
      version: KNOWN_BROKEN_NODE_PTY_VERSION
    });

    const loaded = utilsModule.loadNativeModule('conpty');
    loaded.module.startProcess('powershell.exe', 120, 40, false, 'pipe-2', true, 'unexpected-extra-flag');
    loaded.module.connect(7, 'powershell.exe', 'C:\\repo', { PATH: 'x' }, true, jest.fn());

    expect(originalLoadNativeModule).toHaveBeenCalledWith('conpty');
    expect(originalStartProcess).toHaveBeenCalledWith(
      'powershell.exe',
      120,
      40,
      false,
      'pipe-2',
      true,
      'unexpected-extra-flag'
    );
    expect(originalConnect).toHaveBeenCalledWith(
      7,
      'powershell.exe',
      'C:\\repo',
      { PATH: 'x' },
      true,
      expect.any(Function)
    );
    expect(loaded.compatPatchedMethods).toEqual([
      'startProcess',
      'connect',
      'resize',
      'clear',
      'kill'
    ]);

    expect(ensureWindowsNodePtyCompat({
      platform: 'win32',
      utilsModule,
      packageInfo: { version: KNOWN_BROKEN_NODE_PTY_VERSION }
    })).toEqual({
      applied: false,
      reason: 'already-patched',
      version: KNOWN_BROKEN_NODE_PTY_VERSION
    });
  });

  test('loadNodePty skips the patch when node-pty package metadata is unavailable', () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
    const requireModule = jest.fn((specifier) => {
      if (specifier === 'node-pty/package.json') {
        throw new Error('missing package info');
      }
      if (specifier === 'node-pty') {
        return { spawn: jest.fn() };
      }
      throw new Error(`unexpected module: ${specifier}`);
    });

    const pty = loadNodePty({
      platform: 'win32',
      logger,
      requireModule
    });

    expect(pty).toEqual({ spawn: expect.any(Function) });
    expect(requireModule).toHaveBeenCalledWith('node-pty/package.json');
    expect(requireModule).toHaveBeenCalledWith('node-pty');
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('loadNodePty skips the patch for unaffected versions', () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
    const requireModule = jest.fn(() => ({ spawn: jest.fn() }));
    const utilsModule = {
      loadNativeModule: jest.fn()
    };

    const pty = loadNodePty({
      platform: 'win32',
      logger,
      utilsModule,
      packageInfo: { version: '1.2.0' },
      requireModule
    });

    expect(pty).toEqual({ spawn: expect.any(Function) });
    expect(requireModule).toHaveBeenCalledWith('node-pty');
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('isStartProcessUsageError only matches the native usage message', () => {
    expect(isStartProcessUsageError(new Error('Usage: pty.startProcess(file, cols, rows, debug, pipeName, inheritCursor)'))).toBe(true);
    expect(isStartProcessUsageError(new Error('other failure'))).toBe(false);
    expect(isStartProcessUsageError(null)).toBe(false);
  });

  test('usage helpers only match the expected native signatures', () => {
    expect(isConptyUsageError(new Error('Usage: pty.connect(id, cmdline, cwd, env, exitCallback)'), 'connect')).toBe(true);
    expect(isConnectUsageError(new Error('Usage: pty.connect(id, cmdline, cwd, env, exitCallback)'))).toBe(true);
    expect(isConnectUsageError(new Error('Usage: pty.startProcess(file, cols, rows, debug, pipeName, inheritCursor)'))).toBe(false);
    expect(isConptyUsageError(new Error('other failure'), 'kill')).toBe(false);
  });
});
