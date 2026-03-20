const {
  KNOWN_BROKEN_NODE_PTY_VERSION,
  ensureWindowsNodePtyCompat,
  loadNodePty,
  wrapConptyStartProcess
} = require('../../server/utils/nodePtyCompat');

describe('nodePtyCompat', () => {
  test('wrapConptyStartProcess truncates the incompatible seventh argument', () => {
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
      true
    );
    expect(wrapConptyStartProcess(nativeModule)).toBe(false);
  });

  test('ensureWindowsNodePtyCompat wraps loadNativeModule for the affected Windows build', () => {
    const originalStartProcess = jest.fn(() => ({ pty: 456 }));
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
      true
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
});
