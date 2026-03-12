/**
 * Unit tests for PortRegistry
 */

const { PortRegistry } = require('../../server/portRegistry');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('PortRegistry', () => {
  let registry;
  const testRegistryPath = path.join(os.tmpdir(), 'test-port-registry.json');

  beforeEach(async () => {
    // Clear singleton for testing
    PortRegistry.instance = null;
    registry = PortRegistry.getInstance();
    registry.registryPath = testRegistryPath;
    registry.assignments = new Map();

    // Clean up test file
    try {
      await fs.unlink(testRegistryPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testRegistryPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }
    PortRegistry.instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = PortRegistry.getInstance();
      const instance2 = PortRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('suggestPort', () => {
    it('should suggest port based on worktree number', async () => {
      const port = await registry.suggestPort(1, '/test/repo', 'work1');
      expect(port).toBeGreaterThanOrEqual(8000);
      expect(port).toBeLessThan(9000);
    });

    it('should return same port for same worktree', async () => {
      const port1 = await registry.suggestPort(1, '/test/repo', 'work1');
      const port2 = await registry.suggestPort(1, '/test/repo', 'work1');
      expect(port1).toBe(port2);
    });

    it('should return different ports for different worktrees', async () => {
      const port1 = await registry.suggestPort(1, '/test/repo', 'work1');
      const port2 = await registry.suggestPort(2, '/test/repo', 'work2');
      expect(port1).not.toBe(port2);
    });
  });

  describe('getPortInfo', () => {
    it('should return port info for registered port', async () => {
      await registry.suggestPort(1, '/test/repo', 'work1');
      const info = registry.getPortInfo('/test/repo', 'work1');
      expect(info).toBeDefined();
      expect(info.port).toBeDefined();
    });

    it('should return null for unregistered port', () => {
      const info = registry.getPortInfo('/nonexistent', 'work99');
      expect(info).toBeNull();
    });
  });

  describe('releasePort', () => {
    it('should release registered port', async () => {
      await registry.suggestPort(1, '/test/repo', 'work1');
      registry.releasePort('/test/repo', 'work1');
      const info = registry.getPortInfo('/test/repo', 'work1');
      expect(info).toBeNull();
    });

    it('should handle releasing non-existent port gracefully', () => {
      expect(() => {
        registry.releasePort('/nonexistent', 'work99');
      }).not.toThrow();
    });
  });

  describe('getAllAssignments', () => {
    it('should return all port assignments as object', async () => {
      await registry.suggestPort(1, '/test/repo', 'work1');
      await registry.suggestPort(2, '/test/repo', 'work2');

      const assignments = registry.getAllAssignments();
      expect(typeof assignments).toBe('object');
      expect(Object.keys(assignments).length).toBe(2);
    });

    it('should return empty object when no assignments', () => {
      const assignments = registry.getAllAssignments();
      expect(typeof assignments).toBe('object');
      expect(Object.keys(assignments).length).toBe(0);
    });
  });

  describe('identifyService', () => {
    it('labels the Agent Workspace default ports', () => {
      expect(registry.identifyService(9460, 'node')).toMatchObject({
        name: 'Agent Workspace',
        type: 'agent-workspace'
      });
      expect(registry.identifyService(9461, 'node')).toMatchObject({
        name: 'Agent Workspace UI',
        type: 'agent-workspace-ui'
      });
      expect(registry.identifyService(9462, 'node')).toMatchObject({
        name: 'Agent Workspace Diff Viewer',
        type: 'agent-workspace-diff-viewer'
      });
      expect(registry.identifyService(9463, 'node')).toMatchObject({
        name: 'Agent Workspace Tauri Dev',
        type: 'agent-workspace-tauri'
      });
    });
  });
});
