const { EventEmitter } = require('events');

describe('ClaudeVersionChecker Windows spawn options', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('child_process');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
  });

  test('hides the version probe process on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });

    const spawn = jest.fn();
    jest.doMock('child_process', () => ({ spawn }));

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawn.mockReturnValue(child);

    const { ClaudeVersionChecker } = require('../../server/claudeVersionChecker');
    const resultPromise = ClaudeVersionChecker.checkVersion();

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['--version'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        windowsHide: true,
        creationFlags: 0x08000000
      })
    );

    child.stdout.emit('data', Buffer.from('1.0.24\n'));
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        version: '1.0.24',
        isCompatible: true
      })
    );
  });
});
