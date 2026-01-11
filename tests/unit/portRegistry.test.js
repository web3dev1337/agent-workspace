/**
 * Unit tests for PortRegistry
 */

describe('PortRegistry', () => {
  let PortRegistry;
  let registry;

  beforeEach(() => {
    jest.resetModules();
    // Clear singleton
    jest.mock('child_process', () => ({
      exec: jest.fn((cmd, opts, cb) => {
        // Simulate port check - fail means port is free
        if (typeof opts === 'function') {
          opts(new Error('no process'), '', '');
        } else {
          cb(new Error('no process'), '', '');
        }
      })
    }));

    // Reset module to get fresh singleton
    PortRegistry = require('../../server/portRegistry').PortRegistry;
    // Create new instance for testing (bypass singleton)
    registry = new PortRegistry();
  });

  describe('port assignment', () => {
    it('should assign unique ports to different worktrees', async () => {
      const port1 = await registry.getPort('/repo/path', 'work1');
      const port2 = await registry.getPort('/repo/path', 'work2');

      expect(port1).not.toBe(port2);
      expect(port1).toBeGreaterThanOrEqual(8080);
      expect(port2).toBeGreaterThanOrEqual(8080);
    });

    it('should return same port for same repo/worktree', async () => {
      const port1 = await registry.getPort('/repo/path', 'work1');
      const port2 = await registry.getPort('/repo/path', 'work1');

      expect(port1).toBe(port2);
    });

    it('should release ports correctly', async () => {
      const port = await registry.getPort('/repo/path', 'work1');

      expect(registry.usedPorts.has(port)).toBe(true);

      registry.releasePort('/repo/path', 'work1');

      expect(registry.usedPorts.has(port)).toBe(false);
    });
  });

  describe('suggestPort', () => {
    it('should suggest preferred port based on worktree number', async () => {
      const port = await registry.suggestPort(1, '/repo/path', 'work1');
      expect(port).toBe(8080); // work1 gets 8080
    });

    it('should fallback if preferred port taken', async () => {
      // Take 8080 first
      await registry.suggestPort(1, '/other/repo', 'work1');

      // Now try to get 8080 for different repo
      const port = await registry.suggestPort(1, '/repo/path', 'work1');

      // Should get next available
      expect(port).toBeGreaterThan(8080);
    });
  });

  describe('key generation', () => {
    it('should create unique keys for repo/worktree combos', () => {
      const key1 = registry.makeKey('/repo/path', 'work1');
      const key2 = registry.makeKey('/repo/path', 'work2');
      const key3 = registry.makeKey('/other/repo', 'work1');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should parse keys correctly', () => {
      const [repoPath, worktreeId] = registry.parseKey('/repo/path:work1');

      expect(repoPath).toBe('/repo/path');
      expect(worktreeId).toBe('work1');
    });
  });

  describe('getAllAssignments', () => {
    it('should return all current assignments', async () => {
      await registry.getPort('/repo1', 'work1');
      await registry.getPort('/repo2', 'work2');

      const assignments = registry.getAllAssignments();

      expect(Object.keys(assignments).length).toBe(2);
    });
  });
});
