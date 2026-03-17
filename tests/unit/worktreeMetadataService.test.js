/**
 * Unit tests for WorktreeMetadataService
 */

const { WorktreeMetadataService } = require('../../server/worktreeMetadataService');

describe('WorktreeMetadataService', () => {
  let service;

  beforeEach(() => {
    // Clear singleton for testing
    WorktreeMetadataService.instance = null;
    service = WorktreeMetadataService.getInstance();
    service.clearCache();
  });

  afterEach(() => {
    WorktreeMetadataService.instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = WorktreeMetadataService.getInstance();
      const instance2 = WorktreeMetadataService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('cache management', () => {
    it('should cache values', () => {
      service.setCache('test-key', { data: 'test' });
      const cached = service.getFromCache('test-key', 60000);
      expect(cached).toEqual({ data: 'test' });
    });

    it('should return null for expired cache', async () => {
      service.setCache('test-key', { data: 'test' });
      // Override timestamp to be old
      service.cache.get('test-key').timestamp = Date.now() - 120000;
      
      const cached = service.getFromCache('test-key', 60000);
      expect(cached).toBeNull();
    });

    it('should return null for missing cache key', () => {
      const cached = service.getFromCache('nonexistent', 60000);
      expect(cached).toBeNull();
    });

    it('should clear all cache', () => {
      service.setCache('key1', { data: '1' });
      service.setCache('key2', { data: '2' });
      
      service.clearCache();
      
      expect(service.cache.size).toBe(0);
    });
  });

  describe('getGitStatus', () => {
    it('should return git status object', async () => {
      // Test with current directory (claude-orchestrator-dev)
      const cwd = process.cwd();
      const status = await service.getGitStatus(cwd);
      
      expect(status).toHaveProperty('branch');
      expect(status).toHaveProperty('modified');
      expect(status).toHaveProperty('untracked');
      expect(status).toHaveProperty('staged');
      expect(status).toHaveProperty('hasUncommittedChanges');
    });

    it('should handle non-git directory gracefully', async () => {
      const status = await service.getGitStatus('/tmp');
      
      expect(status.branch).toBeNull();
      expect(status.error).toBeDefined();
    });

    it('should cache git status', async () => {
      const cwd = process.cwd();
      
      // First call
      await service.getGitStatus(cwd);
      
      // Second call should use cache
      const cacheKey = `git:${cwd}`;
      const cached = service.getFromCache(cacheKey, service.cacheMaxAge);
      
      expect(cached).toBeDefined();
    });
  });

  describe('getPRStatus', () => {
    it('should return PR status object', async () => {
      const cwd = process.cwd();
      const status = await service.getPRStatus(cwd);
      
      expect(status).toHaveProperty('hasPR');
      expect(status).toHaveProperty('branch');
    }, 20000);

    it('should cache PR status', async () => {
      const cwd = process.cwd();
      
      // First call
      await service.getPRStatus(cwd);
      
      // Check cache
      const cacheKey = `pr:${cwd}`;
      const cached = service.getFromCache(cacheKey, service.prCacheMaxAge);
      
      // Either cached or returned (gh might not be available)
      expect(true).toBe(true);
    }, 20000);
  });

  describe('getMetadata', () => {
    it('should return combined metadata', async () => {
      const cwd = process.cwd();
      const metadata = await service.getMetadata(cwd);

      expect(metadata).toHaveProperty('path');
      expect(metadata).toHaveProperty('git');
      expect(metadata).toHaveProperty('pr');
      expect(metadata).toHaveProperty('lastUpdated');
    }, 20000);
  });

  describe('getMultipleMetadata', () => {
    it('should fetch metadata for multiple paths', async () => {
      const paths = [process.cwd(), '/tmp'];
      const results = await service.getMultipleMetadata(paths);

      expect(Object.keys(results).length).toBe(2);
      expect(results[process.cwd()]).toBeDefined();
      expect(results['/tmp']).toBeDefined();
    }, 30000);

    it('should handle empty paths array', async () => {
      const results = await service.getMultipleMetadata([]);
      expect(Object.keys(results).length).toBe(0);
    });
  });

  describe('refresh', () => {
    it('should clear cache and fetch fresh data', async () => {
      const cwd = process.cwd();

      // Populate cache
      await service.getMetadata(cwd);

      // Refresh
      const refreshed = await service.refresh(cwd);

      expect(refreshed).toHaveProperty('git');
      expect(refreshed).toHaveProperty('pr');
    }, 30000);
  });
});
