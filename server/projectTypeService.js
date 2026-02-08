const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'project-types.json');

const FALLBACK_TAXONOMY = {
  version: 1,
  categories: [
    {
      id: 'website',
      name: 'Website',
      description: 'Frontend and full-stack web projects',
      basePath: 'websites',
      keywords: ['website', 'web app', 'frontend', 'landing page', 'portfolio', 'blog'],
      defaultTemplateId: 'website-starter',
      defaultRepositoryType: 'website',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'website',
      frameworkIds: ['web-generic']
    },
    {
      id: 'game',
      name: 'Game',
      description: 'Game projects',
      basePath: 'games',
      keywords: ['game', 'hytopia', 'unity', 'godot', 'gaming', 'monogame'],
      defaultTemplateId: 'hytopia-game-starter',
      defaultRepositoryType: 'hytopia-game',
      defaultLaunchSettingsType: 'hytopia-game',
      buttonProfileId: 'hytopia-game',
      frameworkIds: ['hytopia', 'monogame']
    },
    {
      id: 'tool',
      name: 'Tool',
      description: 'Developer tools and automations',
      basePath: 'tools',
      keywords: ['tool', 'cli', 'utility', 'automation', 'script'],
      defaultTemplateId: 'node-typescript-tool',
      defaultRepositoryType: 'tool-project',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'tool',
      frameworkIds: ['nodejs']
    },
    {
      id: 'api',
      name: 'API',
      description: 'Backend APIs and services',
      basePath: 'apis',
      keywords: ['api', 'backend', 'server', 'service', 'rest', 'graphql'],
      defaultTemplateId: 'node-typescript-tool',
      defaultRepositoryType: 'tool-project',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'tool',
      frameworkIds: ['nodejs']
    },
    {
      id: 'library',
      name: 'Library',
      description: 'Reusable packages and SDKs',
      basePath: 'libraries',
      keywords: ['library', 'package', 'module', 'npm', 'sdk'],
      defaultTemplateId: 'node-typescript-tool',
      defaultRepositoryType: 'tool-project',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'tool',
      frameworkIds: ['nodejs']
    },
    {
      id: 'writing',
      name: 'Writing',
      description: 'Documentation and writing work',
      basePath: 'writing',
      keywords: ['writing', 'docs', 'book', 'article', 'documentation'],
      defaultTemplateId: 'generic-empty',
      defaultRepositoryType: 'writing',
      defaultLaunchSettingsType: 'writing',
      buttonProfileId: 'writing',
      frameworkIds: ['generic']
    },
    {
      id: 'other',
      name: 'Other',
      description: 'Miscellaneous projects',
      basePath: 'projects',
      keywords: [],
      defaultTemplateId: 'generic-empty',
      defaultRepositoryType: 'generic',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'generic',
      frameworkIds: ['generic']
    }
  ],
  frameworks: [
    {
      id: 'web-generic',
      name: 'Web',
      description: 'Generic web stack',
      categoryId: 'website',
      defaultTemplateId: 'website-starter',
      templateIds: ['website-starter', 'node-typescript-tool']
    },
    {
      id: 'hytopia',
      name: 'Hytopia',
      description: 'Hytopia game development',
      categoryId: 'game',
      defaultTemplateId: 'hytopia-game-starter',
      templateIds: ['hytopia-game-starter']
    },
    {
      id: 'monogame',
      name: 'MonoGame',
      description: 'MonoGame projects',
      categoryId: 'game',
      defaultTemplateId: 'generic-empty',
      templateIds: ['generic-empty']
    },
    {
      id: 'nodejs',
      name: 'Node.js',
      description: 'Node.js tooling and services',
      categoryId: 'tool',
      defaultTemplateId: 'node-typescript-tool',
      templateIds: ['node-typescript-tool', 'generic-empty']
    },
    {
      id: 'generic',
      name: 'Generic',
      description: 'Generic projects',
      categoryId: 'other',
      defaultTemplateId: 'generic-empty',
      templateIds: ['generic-empty']
    }
  ],
  templates: [
    {
      id: 'website-starter',
      name: 'Website Starter',
      description: 'Simple website scaffold',
      frameworkId: 'web-generic',
      scaffoldPath: 'templates/scaffolds/website',
      defaultRepositoryType: 'website',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'website'
    },
    {
      id: 'hytopia-game-starter',
      name: 'Hytopia Starter',
      description: 'Hytopia game scaffold',
      frameworkId: 'hytopia',
      scaffoldPath: 'templates/scaffolds/hytopia-game',
      defaultRepositoryType: 'hytopia-game',
      defaultLaunchSettingsType: 'hytopia-game',
      buttonProfileId: 'hytopia-game'
    },
    {
      id: 'node-typescript-tool',
      name: 'Node TypeScript',
      description: 'Node.js + TypeScript starter',
      frameworkId: 'nodejs',
      scaffoldPath: 'templates/scaffolds/cli-tool',
      defaultRepositoryType: 'tool-project',
      defaultLaunchSettingsType: 'website',
      buttonProfileId: 'tool'
    },
    {
      id: 'generic-empty',
      name: 'Empty Project',
      description: 'Minimal scaffold',
      frameworkId: 'generic',
      scaffoldPath: 'templates/scaffolds/generic',
      defaultRepositoryType: 'generic',
      defaultLaunchSettingsType: 'writing',
      buttonProfileId: 'generic'
    }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePathForApi(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function expandUserPath(input) {
  const raw = normalizeString(input);
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function resolveGitHubRoot() {
  const envRoot = normalizeString(process.env.GREENFIELD_GITHUB_ROOT || process.env.GITHUB_ROOT || '');
  if (!envRoot) return path.join(os.homedir(), 'GitHub');
  return expandUserPath(envRoot);
}

class ProjectTypeService {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.configPath = options.configPath || DEFAULT_CONFIG_PATH;
    this.gitHubRoot = resolveGitHubRoot();
    this.taxonomy = this.normalizeTaxonomy(FALLBACK_TAXONOMY);
    this.lastLoadedAt = null;
    this.lastLoadSource = 'fallback';
    this.reload();
  }

  static getInstance(options = {}) {
    if (!ProjectTypeService.instance) {
      ProjectTypeService.instance = new ProjectTypeService(options);
    }
    return ProjectTypeService.instance;
  }

  resolveBasePath(basePath) {
    const raw = normalizeString(basePath);
    if (!raw) return this.gitHubRoot;
    const expanded = expandUserPath(raw);
    if (path.isAbsolute(expanded)) return expanded;
    return path.join(this.gitHubRoot, expanded);
  }

  normalizeTaxonomy(input) {
    const source = (input && typeof input === 'object') ? input : {};
    const version = Number(source.version) || 1;

    const templateIds = new Set();
    const templates = [];
    for (const row of Array.isArray(source.templates) ? source.templates : []) {
      const id = normalizeString(row?.id);
      if (!id || templateIds.has(id)) continue;
      templateIds.add(id);
      templates.push({
        id,
        name: normalizeString(row?.name) || id,
        description: normalizeString(row?.description),
        frameworkId: normalizeString(row?.frameworkId),
        scaffoldPath: normalizeString(row?.scaffoldPath),
        defaultRepositoryType: normalizeString(row?.defaultRepositoryType) || 'generic',
        defaultLaunchSettingsType: normalizeString(row?.defaultLaunchSettingsType) || 'website',
        buttonProfileId: normalizeString(row?.buttonProfileId) || 'generic'
      });
    }

    const frameworkIds = new Set();
    const frameworks = [];
    for (const row of Array.isArray(source.frameworks) ? source.frameworks : []) {
      const id = normalizeString(row?.id);
      if (!id || frameworkIds.has(id)) continue;
      frameworkIds.add(id);

      const rowTemplateIds = [];
      for (const templateId of Array.isArray(row?.templateIds) ? row.templateIds : []) {
        const normalized = normalizeString(templateId);
        if (!normalized || rowTemplateIds.includes(normalized)) continue;
        if (!templateIds.has(normalized)) continue;
        rowTemplateIds.push(normalized);
      }

      const defaultTemplateId = normalizeString(row?.defaultTemplateId);
      if (defaultTemplateId && templateIds.has(defaultTemplateId) && !rowTemplateIds.includes(defaultTemplateId)) {
        rowTemplateIds.unshift(defaultTemplateId);
      }

      frameworks.push({
        id,
        name: normalizeString(row?.name) || id,
        description: normalizeString(row?.description),
        categoryId: normalizeString(row?.categoryId),
        defaultTemplateId: rowTemplateIds[0] || null,
        templateIds: rowTemplateIds
      });
    }

    const categories = [];
    const categoryIds = new Set();
    for (const row of Array.isArray(source.categories) ? source.categories : []) {
      const id = normalizeString(row?.id);
      if (!id || categoryIds.has(id)) continue;
      categoryIds.add(id);

      const rowFrameworkIds = [];
      for (const frameworkId of Array.isArray(row?.frameworkIds) ? row.frameworkIds : []) {
        const normalized = normalizeString(frameworkId);
        if (!normalized || rowFrameworkIds.includes(normalized)) continue;
        if (!frameworkIds.has(normalized)) continue;
        rowFrameworkIds.push(normalized);
      }

      const keywords = [];
      for (const keyword of Array.isArray(row?.keywords) ? row.keywords : []) {
        const normalized = normalizeString(keyword).toLowerCase();
        if (!normalized || keywords.includes(normalized)) continue;
        keywords.push(normalized);
      }

      const resolvedBasePath = this.resolveBasePath(row?.basePath || 'projects');
      const defaultTemplateId = normalizeString(row?.defaultTemplateId);
      const safeDefaultTemplateId = templateIds.has(defaultTemplateId)
        ? defaultTemplateId
        : this.findDefaultTemplateForCategory(rowFrameworkIds, frameworks);

      categories.push({
        id,
        name: normalizeString(row?.name) || id,
        description: normalizeString(row?.description),
        basePath: normalizeString(row?.basePath || 'projects'),
        basePathResolved: resolvedBasePath,
        basePathResolvedNormalized: normalizePathForApi(resolvedBasePath),
        keywords,
        defaultTemplateId: safeDefaultTemplateId,
        defaultRepositoryType: normalizeString(row?.defaultRepositoryType) || 'generic',
        defaultLaunchSettingsType: normalizeString(row?.defaultLaunchSettingsType) || 'website',
        buttonProfileId: normalizeString(row?.buttonProfileId) || 'generic',
        frameworkIds: rowFrameworkIds
      });
    }

    const frameworkById = Object.fromEntries(frameworks.map((framework) => [framework.id, framework]));
    const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]));

    const normalizedFrameworks = frameworks.map((framework) => {
      const categoryId = categoryById[framework.categoryId]
        ? framework.categoryId
        : this.findCategoryForFramework(framework.id, categories);
      const templateIdsForFramework = framework.templateIds.filter((templateId) => {
        const template = templates.find((item) => item.id === templateId);
        return !!template && (!template.frameworkId || template.frameworkId === framework.id);
      });
      return {
        ...framework,
        categoryId: categoryId || '',
        defaultTemplateId: templateIdsForFramework.includes(framework.defaultTemplateId)
          ? framework.defaultTemplateId
          : (templateIdsForFramework[0] || null),
        templateIds: templateIdsForFramework
      };
    });

    const normalizedCategories = categories.map((category) => {
      const frameworkIdsForCategory = category.frameworkIds.filter((frameworkId) => {
        const framework = frameworkById[frameworkId];
        return !!framework;
      });
      return {
        ...category,
        frameworkIds: frameworkIdsForCategory,
        defaultTemplateId: category.defaultTemplateId
          || this.findDefaultTemplateForCategory(frameworkIdsForCategory, normalizedFrameworks)
      };
    });

    const normalizedTemplates = templates.map((template) => {
      let categoryId = '';
      if (template.frameworkId && frameworkById[template.frameworkId]) {
        const parentFramework = normalizedFrameworks.find((item) => item.id === template.frameworkId);
        categoryId = normalizeString(parentFramework?.categoryId);
      }
      return {
        ...template,
        categoryId
      };
    });

    return {
      version,
      gitHubRoot: this.gitHubRoot,
      categories: normalizedCategories,
      frameworks: normalizedFrameworks,
      templates: normalizedTemplates,
      indexes: {
        categoryIds: normalizedCategories.map((item) => item.id),
        frameworkIds: normalizedFrameworks.map((item) => item.id),
        templateIds: normalizedTemplates.map((item) => item.id)
      }
    };
  }

  findDefaultTemplateForCategory(frameworkIds, frameworks) {
    for (const frameworkId of Array.isArray(frameworkIds) ? frameworkIds : []) {
      const framework = frameworks.find((item) => item.id === frameworkId);
      if (framework?.defaultTemplateId) return framework.defaultTemplateId;
      if (Array.isArray(framework?.templateIds) && framework.templateIds[0]) return framework.templateIds[0];
    }
    return null;
  }

  findCategoryForFramework(frameworkId, categories) {
    for (const category of categories) {
      if (Array.isArray(category.frameworkIds) && category.frameworkIds.includes(frameworkId)) {
        return category.id;
      }
    }
    return '';
  }

  reload() {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.taxonomy = this.normalizeTaxonomy(FALLBACK_TAXONOMY);
        this.lastLoadedAt = new Date().toISOString();
        this.lastLoadSource = 'fallback';
        this.logger.warn?.('project-types config missing, using fallback taxonomy', { configPath: this.configPath });
        return this.getTaxonomy();
      }

      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.taxonomy = this.normalizeTaxonomy(parsed);
      this.lastLoadedAt = new Date().toISOString();
      this.lastLoadSource = this.configPath;
      this.logger.info?.('Loaded project-types taxonomy', {
        configPath: this.configPath,
        categories: this.taxonomy.categories.length,
        frameworks: this.taxonomy.frameworks.length,
        templates: this.taxonomy.templates.length
      });
      return this.getTaxonomy();
    } catch (error) {
      this.taxonomy = this.normalizeTaxonomy(FALLBACK_TAXONOMY);
      this.lastLoadedAt = new Date().toISOString();
      this.lastLoadSource = 'fallback';
      this.logger.error?.('Failed to load project-types taxonomy, using fallback', {
        configPath: this.configPath,
        error: error.message
      });
      return this.getTaxonomy();
    }
  }

  getTaxonomy() {
    const payload = clone(this.taxonomy);
    payload.meta = {
      loadedAt: this.lastLoadedAt,
      source: this.lastLoadSource
    };
    return payload;
  }

  getCategories() {
    return clone(this.taxonomy.categories || []);
  }

  getCategoryById(categoryId) {
    const id = normalizeString(categoryId);
    if (!id) return null;
    return this.getCategories().find((category) => category.id === id) || null;
  }

  getFrameworks(filters = {}) {
    const categoryId = normalizeString(filters.categoryId);
    const out = clone(this.taxonomy.frameworks || []);
    if (!categoryId) return out;
    return out.filter((framework) => framework.categoryId === categoryId);
  }

  getTemplates(filters = {}) {
    const frameworkId = normalizeString(filters.frameworkId);
    const categoryId = normalizeString(filters.categoryId);
    const templates = clone(this.taxonomy.templates || []);

    if (frameworkId) {
      return templates.filter((template) => template.frameworkId === frameworkId);
    }

    if (categoryId) {
      return templates.filter((template) => template.categoryId === categoryId);
    }

    return templates;
  }

  detectCategory(description) {
    const text = normalizeString(description).toLowerCase();
    if (!text) return 'other';

    const categories = this.taxonomy.categories || [];
    let bestCategoryId = 'other';
    let bestScore = 0;

    for (const category of categories) {
      const keywords = Array.isArray(category.keywords) ? category.keywords : [];
      let score = 0;
      for (const keyword of keywords) {
        if (!keyword) continue;
        if (text.includes(keyword)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategoryId = category.id;
      }
    }

    return bestCategoryId;
  }
}

module.exports = { ProjectTypeService, DEFAULT_CONFIG_PATH };
