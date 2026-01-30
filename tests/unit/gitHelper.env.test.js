const util = require('util');

let mockExec;
jest.mock('child_process', () => ({
  exec: mockExec
}));

describe('GitHelper environment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.WORKTREE_BASE_PATH = '/tmp';
    process.env.HOME = process.env.HOME || '/home/test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('getCurrentBranch does not override HOME with the worktree path', async () => {
    const calls = [];
    mockExec = jest.fn();
    mockExec[util.promisify.custom] = async (cmd, options) => {
      calls.push({ cmd, options });
      return { stdout: 'main\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    const branch = await helper.getCurrentBranch('/tmp/repo-a/work1', true);
    expect(branch).toBe('main');

    const call = calls.find(c => String(c.cmd).includes('git rev-parse'));
    expect(call).toBeTruthy();
    const opts = call.options;
    expect(opts.cwd).toBe('/tmp/repo-a/work1');
    expect(opts.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(opts.env.HOME).toBe(process.env.HOME);
  });

  test('getRemoteUrl does not override HOME with the worktree path', async () => {
    const calls = [];
    mockExec = jest.fn();
    mockExec[util.promisify.custom] = async (cmd, options) => {
      calls.push({ cmd, options });
      return { stdout: 'git@github.com:owner/repo.git\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    const url = await helper.getRemoteUrl('/tmp/repo-a/work1');
    expect(url).toBe('https://github.com/owner/repo');

    const call = calls.find(c => String(c.cmd).includes('git remote get-url origin'));
    expect(call).toBeTruthy();
    const opts = call.options;
    expect(opts.cwd).toBe('/tmp/repo-a/work1');
    expect(opts.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(opts.env.HOME).toBe(process.env.HOME);
  });
});
