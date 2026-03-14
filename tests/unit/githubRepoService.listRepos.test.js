jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { GitHubRepoService } = require('../../server/githubRepoService');

describe('GitHubRepoService listRepos', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    execFile.mockReset();
    GitHubRepoService.instance = null;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform
    });
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
    expect(execFile).toHaveBeenCalledTimes(1);
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
      'gh',
      expect.arrayContaining(['repo', 'list']),
      expect.objectContaining({
        windowsHide: true,
        creationFlags: 0x08000000
      }),
      expect.any(Function)
    );
  });
});
