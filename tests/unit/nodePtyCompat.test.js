const {
  KNOWN_BROKEN_NODE_PTY_VERSION,
  ensureWindowsNodePtyCompat,
  isStartProcessUsageError,
  loadNodePty,
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

  test('ensureWindowsNodePtyCompat wraps loadNativeModule for the affected Windows build', () => {
    const originalStartProcess = jest.fn(() => ({ pty: 789 }));
    const conptyModule = { startProcess: originalStartProcess };
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
});
