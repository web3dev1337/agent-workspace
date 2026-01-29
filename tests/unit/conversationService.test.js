/**
 * Unit tests for ConversationService
 */

const { ConversationService } = require('../../server/conversationService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('ConversationService', () => {
  let service;
  const testDataDir = path.join(os.tmpdir(), 'test-conversations');

  beforeEach(async () => {
    // Clear singleton for testing
    ConversationService.instance = null;
    service = ConversationService.getInstance();

    // Reset index
    service.index = null;
    service.lastIndexTime = null;

    // Create test directory
    await fs.mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDataDir, { recursive: true });
    } catch (e) {
      // Directory doesn't exist
    }
    ConversationService.instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ConversationService.getInstance();
      const instance2 = ConversationService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Set up mock index
      service.index = {
        conversations: [
          {
            id: 'conv1',
            source: 'claude',
            project: 'test-project',
            branch: 'main',
            cwd: '/home/user/test-project',
            summary: 'Test conversation about authentication',
            preview: 'Help me implement login',
            lastTimestamp: '2025-01-10T10:00:00Z',
            totalTokens: 5000,
            messageCount: 10
          },
          {
            id: 'conv2',
            source: 'codex',
            project: 'other-project',
            branch: 'feature/new',
            cwd: '/home/user/other-project',
            summary: 'Building a dashboard',
            preview: 'Create a dashboard component',
            lastTimestamp: '2025-01-11T10:00:00Z',
            totalTokens: 3000,
            messageCount: 5
          }
        ],
        projects: ['test-project', 'other-project'],
        stats: { totalConversations: 2 }
      };
      service.lastIndexTime = Date.now();
    });

    it('should return all conversations without filters', async () => {
      const results = await service.search('');
      expect(results.results.length).toBe(2);
      expect(results.total).toBe(2);
    });

    it('should filter by text query', async () => {
      const results = await service.search('authentication');
      expect(results.results.length).toBe(1);
      expect(results.results[0].id).toBe('conv1');
    });

    it('should filter by project', async () => {
      const results = await service.search('', { project: 'test-project' });
      expect(results.results.length).toBe(1);
      expect(results.results[0].project).toBe('test-project');
    });

    it('should filter by branch', async () => {
      const results = await service.search('', { branch: 'feature' });
      expect(results.results.length).toBe(1);
      expect(results.results[0].branch).toBe('feature/new');
    });

    it('should filter by folder', async () => {
      const results = await service.search('', { folder: 'other-project' });
      expect(results.results.length).toBe(1);
      expect(results.results[0].id).toBe('conv2');
    });

    it('should filter by source', async () => {
      const results = await service.search('', { source: 'codex' });
      expect(results.results.length).toBe(1);
      expect(results.results[0].id).toBe('conv2');
    });

    it('should apply pagination', async () => {
      const results = await service.search('', { limit: 1, offset: 0 });
      expect(results.results.length).toBe(1);
      expect(results.limit).toBe(1);
      expect(results.offset).toBe(0);
    });
  });

  describe('autocomplete', () => {
    beforeEach(() => {
      service.index = {
        conversations: [
          { project: 'zoo-game', branch: 'main', cwd: '/home/user/zoo-game' },
          { project: 'zoo-game', branch: 'feature/animals', cwd: '/home/user/zoo-game' },
          { project: 'web-app', branch: 'develop', cwd: '/home/user/web-app' }
        ],
        projects: ['zoo-game', 'web-app'],
        stats: {}
      };
      service.lastIndexTime = Date.now();
    });

    it('should return empty for short queries', async () => {
      const suggestions = await service.autocomplete('z');
      expect(suggestions.length).toBe(0);
    });

    it('should return project suggestions', async () => {
      const suggestions = await service.autocomplete('zoo');
      expect(suggestions.some(s => s.type === 'project' && s.value === 'zoo-game')).toBe(true);
    });

    it('should return branch suggestions', async () => {
      const suggestions = await service.autocomplete('feature');
      expect(suggestions.some(s => s.type === 'branch')).toBe(true);
    });

    it('should limit results', async () => {
      const suggestions = await service.autocomplete('zoo', 1);
      expect(suggestions.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getRecent', () => {
    beforeEach(() => {
      service.index = {
        conversations: [
          { id: 'conv1', lastTimestamp: '2025-01-10T10:00:00Z' },
          { id: 'conv2', lastTimestamp: '2025-01-11T10:00:00Z' },
          { id: 'conv3', lastTimestamp: '2025-01-12T10:00:00Z' }
        ],
        projects: [],
        stats: {}
      };
      service.lastIndexTime = Date.now();
    });

    it('should return recent conversations', async () => {
      const recent = await service.getRecent(2);
      expect(recent.length).toBe(2);
    });

    it('should use default limit', async () => {
      const recent = await service.getRecent();
      expect(recent.length).toBe(3);
    });
  });

  describe('getByFolder', () => {
    beforeEach(() => {
      service.index = {
        conversations: [
          { id: 'conv1', cwd: '/home/user/project1/work1' },
          { id: 'conv2', cwd: '/home/user/project1/work2' },
          { id: 'conv3', cwd: '/home/user/project2/work1' }
        ],
        projects: [],
        stats: {}
      };
      service.lastIndexTime = Date.now();
    });

    it('should filter by folder path', async () => {
      const results = await service.getByFolder('project1');
      expect(results.length).toBe(2);
    });

    it('should return empty for non-matching folder', async () => {
      const results = await service.getByFolder('nonexistent');
      expect(results.length).toBe(0);
    });
  });

  describe('getProjects', () => {
    beforeEach(() => {
      service.index = {
        conversations: [],
        projects: ['project1', 'project2', 'project3'],
        stats: {}
      };
      service.lastIndexTime = Date.now();
    });

    it('should return all projects', async () => {
      const projects = await service.getProjects();
      expect(projects.length).toBe(3);
      expect(projects).toContain('project1');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      service.index = {
        conversations: [],
        projects: [],
        stats: {
          totalConversations: 100,
          totalProjects: 10,
          totalMessages: 5000,
          totalTokens: 1000000
        }
      };
      service.lastIndexTime = Date.now();
    });

    it('should return stats', async () => {
      const stats = await service.getStats();
      expect(stats.totalConversations).toBe(100);
      expect(stats.totalProjects).toBe(10);
    });
  });

  describe('detectCategory', () => {
    it('should use cached index when fresh', async () => {
      service.index = { conversations: [], projects: [], stats: {} };
      service.lastIndexTime = Date.now();

      const index = await service.getIndex();
      expect(index).toBe(service.index);
    });
  });
});
