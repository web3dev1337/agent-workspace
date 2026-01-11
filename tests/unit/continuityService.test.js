/**
 * Unit tests for ContinuityService
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
    readdir: jest.fn(),
    readFile: jest.fn(),
    stat: jest.fn(),
  },
  existsSync: jest.fn(),
}));

describe('ContinuityService', () => {
  let ContinuityService;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    ContinuityService = require('../../server/continuityService').ContinuityService;
    service = new ContinuityService();
  });

  describe('parseLedger', () => {
    it('should parse YAML frontmatter', async () => {
      const fs = require('fs').promises;
      const mockContent = `---
date: 2026-01-11T15:00:00Z
project: test-project
---

## Goal
Test the system

## Current State
- Item 1
- Item 2
`;

      fs.readFile.mockResolvedValue(mockContent);

      const ledger = await service.parseLedger('/path/to/ledger.md');

      expect(ledger.frontmatter.date).toBe('2026-01-11T15:00:00Z');
      expect(ledger.frontmatter.project).toBe('test-project');
    });

    it('should parse markdown sections', async () => {
      const fs = require('fs').promises;
      const mockContent = `---
date: 2026-01-11
project: test
---

## Goal
Build something amazing

## Current State
We are making progress

## Next Steps
1. Do thing 1
2. Do thing 2
`;

      fs.readFile.mockResolvedValue(mockContent);

      const ledger = await service.parseLedger('/path/to/ledger.md');

      expect(ledger.sections['Goal']).toContain('Build something amazing');
      expect(ledger.sections['Current State']).toContain('making progress');
      expect(ledger.sections['Next Steps']).toContain('Do thing 1');
    });
  });

  describe('parseListItems', () => {
    it('should parse bullet points', () => {
      const content = `- Item 1
- Item 2
- Item 3`;

      const items = service.parseListItems(content);

      expect(items).toEqual(['Item 1', 'Item 2', 'Item 3']);
    });

    it('should parse numbered lists', () => {
      const content = `1. First
2. Second
3. Third`;

      const items = service.parseListItems(content);

      expect(items).toEqual(['First', 'Second', 'Third']);
    });

    it('should handle empty content', () => {
      expect(service.parseListItems('')).toEqual([]);
      expect(service.parseListItems(null)).toEqual([]);
      expect(service.parseListItems(undefined)).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('should extract summary from ledger', () => {
      const ledger = {
        frontmatter: {
          project: 'test-project',
          date: '2026-01-11'
        },
        sections: {
          'Goal': 'Build something',
          'Current State': 'In progress',
          'Next Steps': '1. Step 1\n2. Step 2',
          'Key Decisions': '- Decision A\n- Decision B'
        }
      };

      const summary = service.getSummary(ledger);

      expect(summary.project).toBe('test-project');
      expect(summary.goal).toBe('Build something');
      expect(summary.nextSteps).toContain('Step 1');
      expect(summary.keyDecisions).toContain('Decision A');
    });

    it('should handle null ledger', () => {
      expect(service.getSummary(null)).toBeNull();
    });
  });

  describe('parseMarkdownSections', () => {
    it('should skip frontmatter when parsing', () => {
      const content = `---
meta: data
---

## Section 1
Content 1

## Section 2
Content 2`;

      const sections = service.parseMarkdownSections(content);

      expect(sections['Section 1']).toBeDefined();
      expect(sections['Section 2']).toBeDefined();
      expect(Object.keys(sections)).not.toContain('meta');
    });
  });
});
