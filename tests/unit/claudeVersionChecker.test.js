jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { ClaudeVersionChecker } = require('../../server/claudeVersionChecker');

describe('ClaudeVersionChecker', () => {
  beforeEach(() => {
    ClaudeVersionChecker.resetCache();
    spawn.mockReset();
  });

  test('caches successful version checks', async () => {
    let stdoutHandler = null;
    let stderrHandler = null;
    let closeHandler = null;
    let errorHandler = null;

    spawn.mockImplementation(() => ({
      stdout: {
        on: (event, handler) => {
          if (event === 'data') stdoutHandler = handler;
        }
      },
      stderr: {
        on: (event, handler) => {
          if (event === 'data') stderrHandler = handler;
        }
      },
      on: (event, handler) => {
        if (event === 'close') closeHandler = handler;
        if (event === 'error') errorHandler = handler;
      }
    }));

    const firstPromise = ClaudeVersionChecker.checkVersion();
    expect(stdoutHandler).toBeInstanceOf(Function);
    expect(stderrHandler).toBeInstanceOf(Function);
    expect(closeHandler).toBeInstanceOf(Function);
    expect(errorHandler).toBeInstanceOf(Function);

    stdoutHandler(Buffer.from('claude 1.2.3'));
    closeHandler(0);

    const first = await firstPromise;
    const second = await ClaudeVersionChecker.checkVersion();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(first).toEqual(expect.objectContaining({
      version: '1.2.3',
      isCompatible: true
    }));
    expect(second).toEqual(first);
  });
});
