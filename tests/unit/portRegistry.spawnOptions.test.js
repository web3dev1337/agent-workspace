const originalPlatform = process.platform;

describe('PortRegistry Windows spawn options', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('child_process');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
  });

  test('hides netstat and tasklist probes on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });

    const execFile = jest.fn((command, args, options, callback) => {
      if (command === 'netstat') {
        callback(null, '  TCP    127.0.0.1:9460     0.0.0.0:0     LISTENING       12345\r\n', '');
        return;
      }
      if (command === 'tasklist') {
        callback(null, '"node.exe","12345","Console","1","12,000 K"\r\n', '');
        return;
      }
      callback(new Error(`unexpected command ${command}`), '', '');
    });

    jest.doMock('child_process', () => ({
      exec: jest.fn(),
      execFile
    }));

    const { PortRegistry } = require('../../server/portRegistry');
    PortRegistry.instance = null;
    const registry = PortRegistry.getInstance();
    const ports = await registry.scanAllPortsWindows();

    expect(ports).toEqual([
      expect.objectContaining({
        port: 9460,
        pid: 12345,
        processName: 'node.exe',
        name: 'Agent Workspace'
      })
    ]);

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'netstat',
      ['-ano', '-p', 'tcp'],
      expect.objectContaining({
        windowsHide: true,
        creationFlags: 0x08000000,
        timeout: 8000
      }),
      expect.any(Function)
    );

    expect(execFile).toHaveBeenNthCalledWith(
      2,
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      expect.objectContaining({
        windowsHide: true,
        creationFlags: 0x08000000,
        timeout: 8000
      }),
      expect.any(Function)
    );
  });
});
