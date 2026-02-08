const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectTypeService } = require('../../server/projectTypeService');

describe('ProjectTypeService', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-types-'));
    ProjectTypeService.instance = null;
  });

  afterEach(() => {
    ProjectTypeService.instance = null;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('loads fallback taxonomy when config file is missing', () => {
    const service = new ProjectTypeService({
      configPath: path.join(tmpDir, 'missing.json'),
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    const taxonomy = service.getTaxonomy();
    expect(Array.isArray(taxonomy.categories)).toBe(true);
    expect(taxonomy.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(taxonomy.frameworks)).toBe(true);
    expect(Array.isArray(taxonomy.templates)).toBe(true);
  });

  test('loads taxonomy from config and filters frameworks/templates', () => {
    const configPath = path.join(tmpDir, 'project-types.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      categories: [
        {
          id: 'alpha',
          name: 'Alpha',
          basePath: 'alpha',
          keywords: ['alpha'],
          defaultTemplateId: 'alpha-template',
          frameworkIds: ['alpha-fw']
        }
      ],
      frameworks: [
        {
          id: 'alpha-fw',
          name: 'Alpha Framework',
          categoryId: 'alpha',
          defaultTemplateId: 'alpha-template',
          templateIds: ['alpha-template']
        }
      ],
      templates: [
        {
          id: 'alpha-template',
          name: 'Alpha Template',
          frameworkId: 'alpha-fw',
          scaffoldPath: 'templates/scaffolds/generic'
        }
      ]
    }, null, 2));

    const service = new ProjectTypeService({
      configPath,
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    expect(service.getCategories().map((item) => item.id)).toEqual(['alpha']);
    expect(service.getFrameworks({ categoryId: 'alpha' }).map((item) => item.id)).toEqual(['alpha-fw']);
    expect(service.getTemplates({ frameworkId: 'alpha-fw' }).map((item) => item.id)).toEqual(['alpha-template']);
    expect(service.getCategoryById('alpha')?.basePathResolvedNormalized).toContain('/alpha');
  });

  test('detectCategory picks category by keyword score', () => {
    const configPath = path.join(tmpDir, 'project-types.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      categories: [
        { id: 'game', name: 'Game', basePath: 'games', keywords: ['game', 'hytopia'], frameworkIds: [] },
        { id: 'tool', name: 'Tool', basePath: 'tools', keywords: ['tool', 'automation'], frameworkIds: [] },
        { id: 'other', name: 'Other', basePath: 'projects', keywords: [], frameworkIds: [] }
      ],
      frameworks: [],
      templates: []
    }, null, 2));

    const service = new ProjectTypeService({
      configPath,
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    expect(service.detectCategory('Build a hytopia game with automation')).toBe('game');
    expect(service.detectCategory('')).toBe('other');
  });
});
