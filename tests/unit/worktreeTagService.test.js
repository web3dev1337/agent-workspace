/**
 * Unit tests for WorktreeTagService
 */

const { WorktreeTagService } = require('../../server/worktreeTagService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('WorktreeTagService', () => {
  const testConfigPath = path.join(os.tmpdir(), 'test-worktree-tags.json');
  let service;

  beforeEach(async () => {
    WorktreeTagService.instance = null;

    try {
      await fs.unlink(testConfigPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }

    service = new WorktreeTagService({ configPath: testConfigPath });
  });

  afterEach(async () => {
    try {
      await fs.unlink(testConfigPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }
    WorktreeTagService.instance = null;
  });

  it('should default to empty tags', () => {
    expect(service.getAll()).toEqual({});
  });

  it('should persist readyForReview tag by worktreePath', async () => {
    const worktreePath = '/tmp/repo/work1';

    const updated = await service.setReadyForReview(worktreePath, true);
    expect(updated).toHaveProperty('readyForReview', true);
    expect(updated).toHaveProperty('updatedAt');

    const all = service.getAll();
    expect(all[worktreePath]).toHaveProperty('readyForReview', true);

    const raw = JSON.parse(await fs.readFile(testConfigPath, 'utf8'));
    expect(raw[worktreePath]).toHaveProperty('readyForReview', true);
  });

  it('should load tags from disk on new instance', async () => {
    const worktreePath = '/tmp/repo/work2';
    await service.setReadyForReview(worktreePath, true);

    const service2 = new WorktreeTagService({ configPath: testConfigPath });
    const all = service2.getAll();
    expect(all[worktreePath]).toHaveProperty('readyForReview', true);
  });

  it('should throw if worktreePath is missing', async () => {
    await expect(service.setReadyForReview('', true)).rejects.toThrow('worktreePath is required');
  });
});

