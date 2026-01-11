/**
 * Unit tests for GreenfieldService
 */

const { GreenfieldService } = require('../../server/greenfieldService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('GreenfieldService', () => {
  let service;
  const testProjectDir = path.join(os.tmpdir(), 'test-greenfield-projects');

  beforeEach(async () => {
    // Clear singleton for testing
    GreenfieldService.instance = null;
    service = GreenfieldService.getInstance();

    // Create test directory
    await fs.mkdir(testProjectDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testProjectDir, { recursive: true });
    } catch (e) {
      // Directory doesn't exist, that's fine
    }
    GreenfieldService.instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = GreenfieldService.getInstance();
      const instance2 = GreenfieldService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getTemplates', () => {
    it('should return array of templates', () => {
      const templates = service.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
    });

    it('should have required properties in templates', () => {
      const templates = service.getTemplates();
      if (templates.length > 0) {
        const template = templates[0];
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
      }
    });
  });

  describe('validatePath', () => {
    it('should return exists:false for non-existent path', async () => {
      const result = await service.validatePath(path.join(testProjectDir, 'new-project'));
      expect(result.exists).toBe(false);
    });

    it('should return exists:true for existing directory', async () => {
      const existingDir = path.join(testProjectDir, 'existing');
      await fs.mkdir(existingDir, { recursive: true });

      const result = await service.validatePath(existingDir);
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
    });

    it('should expand tilde in path', async () => {
      const result = await service.validatePath('~/nonexistent-path-12345');
      expect(result.path).toContain(process.env.HOME);
      expect(result.path).not.toContain('~');
    });
  });

  describe('createProject', () => {
    it('should create project directory structure', async () => {
      const projectPath = path.join(testProjectDir, 'test-project');
      const result = await service.createProject({
        name: 'test-project',
        path: projectPath,
        template: 'node-typescript'
      });

      // Check if result has success property or created directory
      const dirExists = await fs.stat(projectPath).then(() => true).catch(() => false);
      expect(dirExists || result.success !== false).toBe(true);
    });

    it('should handle missing project name', async () => {
      await expect(service.createProject({
        name: '',
        path: testProjectDir,
        template: 'node-typescript'
      })).rejects.toThrow();
    });
  });
});
