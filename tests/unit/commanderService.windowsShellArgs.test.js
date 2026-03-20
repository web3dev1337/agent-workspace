const { EventEmitter } = require('events');

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  format: {
    combine: jest.fn(() => ({})),
    timestamp: jest.fn(() => ({})),
    json: jest.fn(() => ({})),
    simple: jest.fn(() => ({}))
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}), { virtual: true });

describe('CommanderService Windows shell args', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  test('does not request a hidden PowerShell window for ConPTY terminals', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });

    const spawn = jest.fn(() => {
      const pty = new EventEmitter();
      pty.onData = jest.fn();
      pty.onExit = jest.fn();
      pty.write = jest.fn();
      pty.resize = jest.fn();
      pty.kill = jest.fn();
      return pty;
    });
    jest.doMock('node-pty', () => ({ spawn }), { virtual: true });

    const { CommanderService } = require('../../server/commanderService');
    CommanderService.instance = null;
    const service = CommanderService.getInstance({ io: null, sessionManager: null });

    const result = await service.start();

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('powershell.exe'),
      expect.not.arrayContaining(['-WindowStyle', 'Hidden']),
      expect.objectContaining({
        name: 'xterm-color'
      })
    );
    // useConpty must NOT be set — node-pty 1.2.0-beta.12 ignores it and
    // ConPTY is already the default on modern Windows.  Passing it caused
    // native arg-count mismatches with cached conpty.node binaries.
    const passedOpts = spawn.mock.calls[0][2];
    expect(passedOpts).not.toHaveProperty('useConpty');

    service.stop();
  });
});
