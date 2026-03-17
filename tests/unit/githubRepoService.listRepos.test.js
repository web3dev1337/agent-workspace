jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { GitHubRepoService } = require('../../server/githubRepoService');

describe('GitHubRepoService listRepos', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    execFile.mockReset();
    GitHubRepoService.instance = null;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
    process.env = { ...originalEnv };
  });

  it('lists repos via gh and normalizes output', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, JSON.stringify([
        { nameWithOwner: 'foo/bar', name: 'bar', owner: { login: 'foo' }, isPrivate: false, isFork: true, visibility: 'PUBLIC' },
        { nameWithOwner: 'acme/secret', name: 'secret', owner: { login: 'acme' }, isPrivate: true, isFork: false, visibility: 'PRIVATE' }
      ]), '');
    });

    const svc = GitHubRepoService.getInstance();
    const repos = await svc.listRepos({ limit: 50, force: true });

    expect(repos).toEqual([
      { nameWithOwner: 'foo/bar', name: 'bar', owner: 'foo', isPrivate: false, isFork: true, visibility: 'public' },
      { nameWithOwner: 'acme/secret', name: 'secret', owner: 'acme', isPrivate: true, isFork: false, visibility: 'private' }
    ]);
  });

  it('caches list results (no force)', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, JSON.stringify([{ nameWithOwner: 'foo/bar', name: 'bar', owner: { login: 'foo' }, isPrivate: false, isFork: false, visibility: 'PUBLIC' }]), '');
    });

    const svc = GitHubRepoService.getInstance();
    const first = await svc.listRepos({ limit: 10, force: true });
    const second = await svc.listRepos({ limit: 10, force: false });

    expect(first).toEqual(second);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('throws when gh fails', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      const err = new Error('boom');
      cb(err, '', 'nope');
    });

    const svc = GitHubRepoService.getInstance();
    await expect(svc.listRepos({ limit: 10, force: true })).rejects.toThrow('Failed to list GitHub repos');
  });

  it('hides gh repo list on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });

    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(null, JSON.stringify([
        { nameWithOwner: 'foo/bar', name: 'bar', owner: { login: 'foo' }, isPrivate: false, isFork: false, visibility: 'PUBLIC' }
      ]), '');
    });

    const svc = GitHubRepoService.getInstance();
    await svc.listRepos({ force: true });

    expect(execFile).toHaveBeenCalledWith(
      expect.any(String),
      ['--version'],
      expect.objectContaining({
        windowsHide: true,
        creationFlags: 0x08000000
      }),
      expect.any(Function)
    );
    expect(execFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['repo', 'list']),
      expect.objectContaining({
        windowsHide: true,
        creationFlags: 0x08000000
      }),
      expect.any(Function)
    );
  });

  it('reports authenticated when gh auth status succeeds via stderr output', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args.includes('--version')) {
        cb(null, 'gh version 2.87.3\n', '');
        return;
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        cb(null, '', 'github.com\n  ✓ Logged in to github.com account octocat (/tmp/hosts.yml)\n  - Active account: true\n');
        return;
      }
      cb(new Error(`Unexpected command: ${cmd} ${args.join(' ')}`), '', '');
    });

    const svc = GitHubRepoService.getInstance();
    const status = await svc.getAuthStatus({ force: true });

    expect(status).toEqual({
      authenticated: true,
      user: 'octocat',
      ghInstalled: true
    });
  });

  it('falls back to Windows install paths when plain gh is not on PATH', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });
    process.env.ProgramFiles = 'C:\\Program Files';

    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (cmd === 'gh.exe') {
        const err = new Error('spawn gh.exe ENOENT');
        err.code = 'ENOENT';
        cb(err, '', '');
        return;
      }
      if (cmd === 'gh') {
        const err = new Error('spawn gh ENOENT');
        err.code = 'ENOENT';
        cb(err, '', '');
        return;
      }
      if (String(cmd).includes('GitHub CLI') && args.includes('--version')) {
        cb(null, 'gh version 2.87.3\n', '');
        return;
      }
      if (String(cmd).includes('GitHub CLI') && args[0] === 'auth' && args[1] === 'status') {
        cb(null, '', 'github.com\n  ✓ Logged in to github.com account windows-user (C:\\Users\\Tester\\AppData\\Roaming\\GitHub CLI\\hosts.yml)\n  - Active account: true\n');
        return;
      }
      cb(new Error(`Unexpected command: ${cmd} ${args.join(' ')}`), '', '');
    });

    const svc = GitHubRepoService.getInstance();
    const status = await svc.getAuthStatus({ force: true });

    expect(status).toEqual({
      authenticated: true,
      user: 'windows-user',
      ghInstalled: true
    });
  });

  it('falls back to hosts.yml when auth probes are inconclusive', async () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-hosts-'));
    const configDir = path.join(tempHome, '.config', 'gh');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'hosts.yml'), [
      'github.com:',
      '    user: cache-user',
      '    oauth_token: gho_test',
      '    git_protocol: https',
      ''
    ].join('\n'));
    process.env.HOME = tempHome;
    process.env.XDG_CONFIG_HOME = path.join(tempHome, '.config');

    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args.includes('--version')) {
        cb(null, 'gh version 2.87.3\n', '');
        return;
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        cb(new Error('status probe failed'), '', '');
        return;
      }
      if (args[0] === 'api' && args[1] === 'user') {
        cb(new Error('api probe failed'), '', '');
        return;
      }
      cb(new Error(`Unexpected command: ${cmd} ${args.join(' ')}`), '', '');
    });

    const svc = GitHubRepoService.getInstance();
    const status = await svc.getAuthStatus({ force: true });

    expect(status).toEqual({
      authenticated: true,
      user: 'cache-user',
      ghInstalled: true
    });
  });

  it('reports gh missing when no candidate resolves', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      const err = new Error(`spawn ${cmd} ENOENT`);
      err.code = 'ENOENT';
      cb(err, '', '');
    });

    const svc = GitHubRepoService.getInstance();
    const status = await svc.getAuthStatus({ force: true });

    expect(status).toEqual({
      authenticated: false,
      user: null,
      ghInstalled: false,
      error: 'GitHub CLI not installed'
    });
  });
});
