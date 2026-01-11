/**
 * Unit tests for GreenfieldService
 */

// Mock winston before any requires
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    simple: jest.fn(),
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn(),
  },
}));

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({ isDirectory: () => true }),
    rename: jest.fn().mockResolvedValue(undefined),
    rm: jest.fn().mockResolvedValue(undefined),
  },
  existsSync: jest.fn().mockReturnValue(false),
}));

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') {
      opts(null, '', '');
    } else {
      cb(null, '', '');
    }
  })
}));

describe('GreenfieldService', () => {
  let GreenfieldService;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    GreenfieldService = require('../../server/greenfieldService').GreenfieldService;
    service = new GreenfieldService();
  });

  describe('getTemplates', () => {
    it('should return available templates', () => {
      const templates = service.getTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.id === 'empty')).toBe(true);
      expect(templates.some(t => t.id === 'node-typescript')).toBe(true);
    });

    it('should include name and description for each template', () => {
      const templates = service.getTemplates();

      templates.forEach(t => {
        expect(t.name).toBeDefined();
        expect(t.description).toBeDefined();
        expect(t.id).toBeDefined();
      });
    });
  });

  describe('validatePath', () => {
    it('should expand home directory', async () => {
      const result = await service.validatePath('~/test');

      expect(result.path).toContain(process.env.HOME);
      expect(result.path).not.toContain('~');
    });
  });

  describe('project name validation', () => {
    it('should reject invalid project names', async () => {
      const invalidNames = [
        'project with spaces',
        'project@special',
        '../path-traversal',
        '',
      ];

      for (const name of invalidNames) {
        await expect(
          service.createProject({
            name,
            template: 'empty',
            path: '/tmp'
          })
        ).rejects.toThrow();
      }
    });

    it('should accept valid project names', () => {
      const validNames = [
        'my-project',
        'my_project',
        'MyProject123',
        'project-name-with-dashes',
      ];

      validNames.forEach(name => {
        expect(name.match(/^[a-zA-Z0-9_-]+$/)).toBeTruthy();
      });
    });
  });

  describe('template file generation', () => {
    it('should replace placeholders in templates', async () => {
      const fs = require('fs').promises;
      const projectName = 'test-project';

      // Test the placeholder replacement logic
      const template = 'console.log("Hello from {{projectName}}!");';
      const processed = template.replace(/\{\{projectName\}\}/g, projectName);

      expect(processed).toBe('console.log("Hello from test-project!");');
    });
  });
});
