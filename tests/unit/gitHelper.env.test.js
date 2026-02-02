const util = require('util');
const fs = require('fs');
const path = require('path');

let mockExecFile;
jest.mock('child_process', () => ({
  execFile: mockExecFile
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
    mockExecFile = jest.fn();
    mockExecFile[util.promisify.custom] = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: 'main\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    const worktreePath = '/tmp/repo-a/work1';
    fs.mkdirSync(worktreePath, { recursive: true });
    const branch = await helper.getCurrentBranch(worktreePath, true);
    expect(branch).toBe('main');

    const call = calls.find(c => String(c.file) === 'git' && Array.isArray(c.args) && c.args.join(' ').includes('rev-parse'));
    expect(call).toBeTruthy();
    const opts = call.options;
    expect(opts.cwd).toBe(worktreePath);
    expect(opts.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(opts.env.HOME).toBe(process.env.HOME);
  });

  test('getRemoteUrl does not override HOME with the worktree path', async () => {
    const calls = [];
    mockExecFile = jest.fn();
    mockExecFile[util.promisify.custom] = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: 'git@github.com:owner/repo.git\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    const worktreePath = '/tmp/repo-a/work1';
    fs.mkdirSync(worktreePath, { recursive: true });
    const url = await helper.getRemoteUrl(worktreePath);
    expect(url).toBe('https://github.com/owner/repo');

    const call = calls.find(c => String(c.file) === 'git' && Array.isArray(c.args) && c.args.join(' ').includes('remote get-url origin'));
    expect(call).toBeTruthy();
    const opts = call.options;
    expect(opts.cwd).toBe(worktreePath);
    expect(opts.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(opts.env.HOME).toBe(process.env.HOME);
  });

  test('invalid worktree path does not throw and returns sentinel', async () => {
    const calls = [];
    mockExecFile = jest.fn();
    mockExecFile[util.promisify.custom] = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: 'main\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    // WORKTREE_BASE_PATH is /tmp in this test; /home/ab is invalid.
    const branch = await helper.getCurrentBranch('/home/<user>/not-allowed', true);
    expect(branch).toBe('invalid-path');
    expect(calls.length).toBe(0);
  });

  test('missing worktree path does not throw and returns sentinel', async () => {
    const calls = [];
    mockExecFile = jest.fn();
    mockExecFile[util.promisify.custom] = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: 'main\n', stderr: '' };
    };

    const { GitHelper } = require('../../server/gitHelper');
    const helper = new GitHelper();

    const missing = path.join('/tmp', 'repo-missing', 'work1');
    try { fs.rmSync(path.join('/tmp', 'repo-missing'), { recursive: true, force: true }); } catch {}
    const branch = await helper.getCurrentBranch(missing, true);
    expect(branch).toBe('missing');
    expect(calls.length).toBe(0);
  });
});
