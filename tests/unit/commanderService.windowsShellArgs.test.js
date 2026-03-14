const { EventEmitter } = require('events');

describe('CommanderService Windows shell args', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('node-pty');
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
    jest.doMock('node-pty', () => ({ spawn }));

    const { CommanderService } = require('../../server/commanderService');
    CommanderService.instance = null;
    const service = CommanderService.getInstance({ io: null, sessionManager: null });

    const result = await service.start();

    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.not.arrayContaining(['-WindowStyle', 'Hidden']),
      expect.objectContaining({
        useConpty: true
      })
    );

    service.stop();
  });
});
