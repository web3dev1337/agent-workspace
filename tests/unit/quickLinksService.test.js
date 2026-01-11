/**
 * Unit tests for QuickLinksService
 */

// Mock winston before requiring the service
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    simple: jest.fn()
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}));

// Mock fs module with both sync and promises
const mockMkdir = jest.fn().mockResolvedValue();
const mockWriteFile = jest.fn().mockResolvedValue();
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile
  }
}));

const { QuickLinksService } = require('../../server/quickLinksService');

describe('QuickLinksService', () => {
  let service;
  const mockConfig = {
    favorites: [
      { name: 'GitHub', url: 'https://github.com', icon: 'github' },
      { name: 'Trello', url: 'https://trello.com', icon: 'trello' }
    ],
    recentSessions: [
      { workspaceId: 'ws1', worktreeId: 'work1', branch: 'main', lastAccess: '2026-01-11T10:00:00Z' }
    ],
    customLinks: []
  };

  beforeEach(() => {
    // Clear singleton
    QuickLinksService.instance = null;
    jest.clearAllMocks();

    // Mock existsSync to return true
    mockExistsSync.mockReturnValue(true);
    // Mock readFileSync to return mock config
    mockReadFileSync.mockReturnValue(JSON.stringify(mockConfig));

    service = new QuickLinksService();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = QuickLinksService.getInstance();
      const instance2 = QuickLinksService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('loadConfig', () => {
    it('should load config from file', () => {
      expect(service.config.favorites).toHaveLength(2);
      expect(service.config.favorites[0].name).toBe('GitHub');
    });

    it('should return default config if file not found', () => {
      mockExistsSync.mockReturnValue(false);
      QuickLinksService.instance = null;
      const newService = new QuickLinksService();

      expect(newService.config.favorites).toBeDefined();
      expect(newService.config.recentSessions).toEqual([]);
    });

    it('should return default config if JSON is invalid', () => {
      mockReadFileSync.mockReturnValue('invalid json');
      QuickLinksService.instance = null;
      const newService = new QuickLinksService();

      expect(newService.config.favorites).toBeDefined();
    });
  });

  describe('getAll', () => {
    it('should return all quick links data', async () => {
      const data = await service.getAll();

      expect(data.favorites).toHaveLength(2);
      expect(data.recentSessions).toBeDefined();
      expect(data.customLinks).toBeDefined();
    });

    it('should limit recent sessions to 10', async () => {
      service.config.recentSessions = Array(15).fill({ workspaceId: 'ws1' });
      const data = await service.getAll();

      expect(data.recentSessions).toHaveLength(10);
    });
  });

  describe('addFavorite', () => {
    it('should add a favorite link', async () => {
      const initialCount = service.config.favorites.length;

      const result = await service.addFavorite({
        name: 'New Link',
        url: 'https://example.com',
        icon: 'link'
      });

      expect(result).toHaveLength(initialCount + 1);
      expect(result[initialCount].name).toBe('New Link');
    });

    it('should reject duplicate URLs', async () => {
      await expect(service.addFavorite({
        name: 'GitHub Clone',
        url: 'https://github.com'
      })).rejects.toThrow('Link already exists');
    });

    it('should require name and URL', async () => {
      await expect(service.addFavorite({ name: 'Test' }))
        .rejects.toThrow('Name and URL are required');

      await expect(service.addFavorite({ url: 'https://test.com' }))
        .rejects.toThrow('Name and URL are required');
    });

    it('should use default icon if not provided', async () => {
      await service.addFavorite({
        name: 'Test',
        url: 'https://test.com'
      });

      const added = service.config.favorites.find(f => f.url === 'https://test.com');
      expect(added.icon).toBe('link');
    });
  });

  describe('removeFavorite', () => {
    it('should remove a favorite by URL', async () => {
      const result = await service.removeFavorite('https://github.com');

      expect(result.find(f => f.url === 'https://github.com')).toBeUndefined();
    });

    it('should throw error if favorite not found', async () => {
      await expect(service.removeFavorite('https://notfound.com'))
        .rejects.toThrow('Favorite not found');
    });
  });

  describe('reorderFavorites', () => {
    it('should reorder favorites by URL list', async () => {
      const newOrder = ['https://trello.com', 'https://github.com'];
      const result = await service.reorderFavorites(newOrder);

      expect(result[0].url).toBe('https://trello.com');
      expect(result[1].url).toBe('https://github.com');
    });

    it('should preserve favorites not in the order list', async () => {
      const newOrder = ['https://trello.com'];
      const result = await service.reorderFavorites(newOrder);

      expect(result).toHaveLength(2);
    });
  });

  describe('trackSession', () => {
    it('should add session to recent sessions', async () => {
      const session = {
        workspaceId: 'ws2',
        worktreeId: 'work3',
        branch: 'feature/test'
      };

      await service.trackSession(session);

      expect(service.config.recentSessions[0].workspaceId).toBe('ws2');
    });

    it('should move existing session to top', async () => {
      await service.trackSession({
        workspaceId: 'ws1',
        worktreeId: 'work1',
        branch: 'develop'
      });

      expect(service.config.recentSessions[0].branch).toBe('develop');
    });

    it('should limit to 20 recent sessions', async () => {
      service.config.recentSessions = Array(20).fill(null).map((_, i) => ({
        workspaceId: `ws${i}`,
        worktreeId: `work${i}`
      }));

      await service.trackSession({
        workspaceId: 'new-ws',
        worktreeId: 'new-work'
      });

      expect(service.config.recentSessions).toHaveLength(20);
      expect(service.config.recentSessions[0].workspaceId).toBe('new-ws');
    });
  });

  describe('clearRecentSessions', () => {
    it('should clear all recent sessions', async () => {
      await service.clearRecentSessions();

      expect(service.config.recentSessions).toEqual([]);
    });
  });

  describe('getRecentSessions', () => {
    it('should return all recent sessions', () => {
      const sessions = service.getRecentSessions();

      expect(sessions).toHaveLength(1);
    });

    it('should filter by workspace ID', () => {
      service.config.recentSessions = [
        { workspaceId: 'ws1' },
        { workspaceId: 'ws2' },
        { workspaceId: 'ws1' }
      ];

      const sessions = service.getRecentSessions({ workspaceId: 'ws1' });

      expect(sessions).toHaveLength(2);
    });

    it('should respect limit option', () => {
      service.config.recentSessions = [
        { workspaceId: 'ws1' },
        { workspaceId: 'ws2' },
        { workspaceId: 'ws3' }
      ];

      const sessions = service.getRecentSessions({ limit: 2 });

      expect(sessions).toHaveLength(2);
    });
  });

  describe('customLinks', () => {
    it('should add a custom link', async () => {
      const result = await service.addCustomLink({
        name: 'Custom Link',
        url: 'https://custom.com',
        category: 'Development'
      });

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('Development');
    });

    it('should use default category if not provided', async () => {
      await service.addCustomLink({
        name: 'Link',
        url: 'https://link.com'
      });

      expect(service.config.customLinks[0].category).toBe('General');
    });

    it('should remove a custom link', async () => {
      await service.addCustomLink({
        name: 'ToRemove',
        url: 'https://remove.com'
      });

      const result = await service.removeCustomLink('https://remove.com');

      expect(result.find(l => l.url === 'https://remove.com')).toBeUndefined();
    });

    it('should get custom links for workspace', async () => {
      service.config.customLinks = [
        { name: 'Global', url: 'https://global.com', workspaceId: null },
        { name: 'WS1', url: 'https://ws1.com', workspaceId: 'ws1' },
        { name: 'WS2', url: 'https://ws2.com', workspaceId: 'ws2' }
      ];

      const links = service.getCustomLinks('ws1');

      expect(links).toHaveLength(2); // Global + WS1
      expect(links.map(l => l.name)).toContain('Global');
      expect(links.map(l => l.name)).toContain('WS1');
    });
  });

  describe('getAvailableIcons', () => {
    it('should return list of available icons', () => {
      const icons = service.getAvailableIcons();

      expect(icons).toContain('github');
      expect(icons).toContain('trello');
      expect(icons).toContain('link');
      expect(Array.isArray(icons)).toBe(true);
    });
  });
});
