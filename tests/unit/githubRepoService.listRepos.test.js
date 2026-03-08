jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { GitHubRepoService } = require('../../server/githubRepoService');

describe('GitHubRepoService listRepos', () => {
  beforeEach(() => {
    execFile.mockReset();
    GitHubRepoService.instance = null;
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
    expect(execFile).toHaveBeenCalledWith(
      'gh',
      ['repo', 'list', '--limit', '50', '--json', 'nameWithOwner,name,owner,isPrivate,visibility,isFork'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    );
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
});
