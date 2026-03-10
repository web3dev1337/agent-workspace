const { EventEmitter } = require('events');

describe('WorktreeHelper Windows spawn options', () => {
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

  test('hides auto-create git commands on Windows', async () => {
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

    const { WorktreeHelper } = require('../../server/worktreeHelper');
    const helper = new WorktreeHelper();
    const resultPromise = helper.executeGitCommand('git worktree list', 'C:\\repo\\master');

    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['worktree', 'list'],
      expect.objectContaining({
        cwd: 'C:\\repo\\master',
        stdio: 'pipe',
        windowsHide: true,
        creationFlags: 0x08000000
      })
    );

    child.stdout.emit('data', Buffer.from('C:/repo/master [main]\n'));
    child.emit('close', 0);

    await expect(resultPromise).resolves.toBe('C:/repo/master [main]');
  });
});
