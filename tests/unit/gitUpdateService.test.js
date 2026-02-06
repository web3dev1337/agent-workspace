const { GitUpdateService } = require('../../server/gitUpdateService');

describe('GitUpdateService branch safety guards', () => {
  test('isPullableBranchName rejects sentinel and invalid branch values', () => {
    expect(GitUpdateService.isPullableBranchName('main')).toBe(true);
    expect(GitUpdateService.isPullableBranchName('feature/my-branch')).toBe(true);
    expect(GitUpdateService.isPullableBranchName('HEAD')).toBe(false);
    expect(GitUpdateService.isPullableBranchName('unknown')).toBe(false);
    expect(GitUpdateService.isPullableBranchName('bad name')).toBe(false);
    expect(GitUpdateService.isPullableBranchName('../oops')).toBe(false);
  });

  test('pullLatest exits early for detached/invalid branches', async () => {
    const service = new GitUpdateService();
    service.getCurrentBranch = jest.fn().mockResolvedValue('HEAD');
    service.getStatus = jest.fn();

    const result = await service.pullLatest();

    expect(result.success).toBe(false);
    expect(String(result.error || '')).toContain('Cannot pull from current branch');
    expect(service.getStatus).not.toHaveBeenCalled();
  });

  test('checkForUpdates exits early for detached/invalid branches', async () => {
    const service = new GitUpdateService();
    service.getCurrentBranch = jest.fn().mockResolvedValue('');
    service.fetchLatest = jest.fn();

    const result = await service.checkForUpdates();

    expect(result.hasUpdates).toBeNull();
    expect(String(result.error || '')).toContain('Cannot check updates');
    expect(service.fetchLatest).not.toHaveBeenCalled();
  });
});
