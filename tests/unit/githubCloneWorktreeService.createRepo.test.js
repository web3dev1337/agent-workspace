const os = require('os');
const path = require('path');
const fs = require('fs');

const { GitHubCloneWorktreeService } = require('../../server/githubCloneWorktreeService');

describe('GitHubCloneWorktreeService.createRepoAndAddWorktree validation', () => {
  const service = new GitHubCloneWorktreeService({ logger: { warn: jest.fn(), error: jest.fn() } });
  const ensure = jest.fn();

  it('rejects missing workspaceId', async () => {
    await expect(service.createRepoAndAddWorktree({
      name: 'my-repo', ensureWorkspaceMixedWorktree: ensure
    })).rejects.toThrow('workspaceId is required');
  });

  it('rejects invalid repo names', async () => {
    for (const bad of ['', 'has space', '../evil', 'a/b', '.dotfirst']) {
      await expect(service.createRepoAndAddWorktree({
        workspaceId: 'ws', name: bad, ensureWorkspaceMixedWorktree: ensure
      })).rejects.toThrow(/Repo name/);
    }
  });

  it('rejects invalid worktree ids', async () => {
    await expect(service.createRepoAndAddWorktree({
      workspaceId: 'ws', name: 'ok-repo', worktreeId: 'banana', ensureWorkspaceMixedWorktree: ensure
    })).rejects.toThrow(/worktreeId/);
  });

  it('rejects an existing repo folder', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-repo-test-'));
    const repoRoot = path.join(tmp, 'taken');
    fs.mkdirSync(path.join(repoRoot, 'master'), { recursive: true });
    const stub = new GitHubCloneWorktreeService({ logger: { warn: jest.fn() } });
    stub.resolvePlacement = () => ({ category: { id: 'game' }, repositoryPath: repoRoot, relativePath: 'x', parentPathNormalized: '' });
    await expect(stub.createRepoAndAddWorktree({
      workspaceId: 'ws', name: 'taken', ensureWorkspaceMixedWorktree: ensure
    })).rejects.toThrow(/already exists/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
