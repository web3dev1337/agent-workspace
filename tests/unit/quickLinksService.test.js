/**
 * Unit tests for QuickLinksService
 */

const { QuickLinksService } = require('../../server/quickLinksService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('QuickLinksService', () => {
  let service;
  const testDataDir = path.join(os.tmpdir(), 'test-quick-links');
  const testConfigPath = path.join(testDataDir, 'quick-links.json');

  beforeEach(async () => {
    // Clear singleton for testing
    QuickLinksService.instance = null;
    service = QuickLinksService.getInstance();
    service.configPath = testConfigPath;

    // Create test directory
    await fs.mkdir(testDataDir, { recursive: true });

    // Reset config
    service.config = {
      favorites: [],
      recentSessions: [],
      customLinks: []
    };
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDataDir, { recursive: true });
    } catch (e) {
      // Directory doesn't exist, that's fine
    }
    QuickLinksService.instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = QuickLinksService.getInstance();
      const instance2 = QuickLinksService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getAll', () => {
    it('should return favorites and recent sessions', async () => {
      const data = await service.getAll();
      expect(data).toHaveProperty('favorites');
      expect(data).toHaveProperty('recentSessions');
      expect(Array.isArray(data.favorites)).toBe(true);
      expect(Array.isArray(data.recentSessions)).toBe(true);
    });
  });

  describe('addFavorite', () => {
    it('should add a new favorite', async () => {
      const favorite = { name: 'Test', url: 'https://test.com', icon: 'star' };
      const favorites = await service.addFavorite(favorite);

      expect(favorites.length).toBe(1);
      expect(favorites[0].name).toBe('Test');
      expect(favorites[0].url).toBe('https://test.com');
    });

    it('should throw on duplicate URLs', async () => {
      const favorite = { name: 'Test', url: 'https://test.com', icon: 'star' };
      await service.addFavorite(favorite);

      await expect(service.addFavorite(favorite)).rejects.toThrow('Link already exists');
    });
  });

  describe('removeFavorite', () => {
    it('should remove a favorite by URL', async () => {
      // First add a favorite
      service.config.favorites = [{ name: 'Test', url: 'https://test.com', icon: 'star' }];
      const favorites = await service.removeFavorite('https://test.com');

      expect(favorites.length).toBe(0);
    });

    it('should throw when removing non-existent favorite', async () => {
      await expect(service.removeFavorite('https://nonexistent.com')).rejects.toThrow('Favorite not found');
    });
  });

  describe('reorderFavorites', () => {
    it('should reorder favorites by URL array', async () => {
      service.config.favorites = [
        { name: 'A', url: 'https://a.com', icon: 'a' },
        { name: 'B', url: 'https://b.com', icon: 'b' },
        { name: 'C', url: 'https://c.com', icon: 'c' }
      ];

      const reordered = await service.reorderFavorites([
        'https://c.com',
        'https://a.com',
        'https://b.com'
      ]);

      expect(reordered[0].url).toBe('https://c.com');
      expect(reordered[1].url).toBe('https://a.com');
      expect(reordered[2].url).toBe('https://b.com');
    });
  });

  describe('trackSession', () => {
    it('should track a session', async () => {
      const sessionInfo = {
        workspaceId: 'ws1',
        sessionId: 'session1',
        worktreePath: '/test/path'
      };

      const sessions = await service.trackSession(sessionInfo);
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe('session1');
    });

    it('should limit recent sessions to max count', async () => {
      // Add more than max sessions
      for (let i = 0; i < 25; i++) {
        await service.trackSession({
          workspaceId: `ws${i}`,
          sessionId: `session${i}`,
          worktreePath: `/test/path${i}`
        });
      }

      const data = await service.getAll();
      expect(data.recentSessions.length).toBeLessThanOrEqual(20);
    });
  });

  describe('getRecentSessions', () => {
    it('should return recent sessions with limit', () => {
      service.config.recentSessions = [
        { sessionId: 'a', lastAccess: Date.now() },
        { sessionId: 'b', lastAccess: Date.now() - 1000 },
        { sessionId: 'c', lastAccess: Date.now() - 2000 }
      ];

      const sessions = service.getRecentSessions({ limit: 2 });
      expect(sessions.length).toBe(2);
    });
  });

  describe('clearRecentSessions', () => {
    it('should clear all recent sessions', async () => {
      await service.trackSession({
        workspaceId: 'ws1',
        sessionId: 'session1',
        worktreePath: '/test/path'
      });

      await service.clearRecentSessions();

      const data = await service.getAll();
      expect(data.recentSessions.length).toBe(0);
    });
  });
});
