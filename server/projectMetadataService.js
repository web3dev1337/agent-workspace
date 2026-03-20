const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const DEFAULT_RISK = 'low';
const ALLOWED_RISKS = new Set(['low', 'medium', 'high', 'critical']);

const normalizeSlash = (p) => String(p || '').replace(/\\/g, '/');

const deriveProjectRootFromWorktreePath = (worktreePath) => {
  const resolved = path.resolve(String(worktreePath || ''));
  const base = path.basename(resolved);

  if (/^work\d+$/i.test(base)) return path.dirname(resolved);
  if (String(base).toLowerCase() === 'master') return path.dirname(resolved);

  const siblingMatch = base.match(/^(.*)-work(\d+)$/i);
  if (siblingMatch?.[1]) {
    return path.join(path.dirname(resolved), siblingMatch[1]);
  }

  return resolved;
};

const mergeProjectMeta = (base, override) => {
  const next = { ...(base || {}) };
  const src = override && typeof override === 'object' ? override : {};

  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    if (k === 'aliases') {
      next.aliases = Array.isArray(v) ? v.filter(Boolean) : [];
      continue;
    }
    next[k] = v;
  }

  const risk = String(next.baseImpactRisk || '').toLowerCase();
  if (risk && ALLOWED_RISKS.has(risk)) {
    next.baseImpactRisk = risk;
  } else if (!next.baseImpactRisk) {
    next.baseImpactRisk = DEFAULT_RISK;
  } else {
    next.baseImpactRisk = DEFAULT_RISK;
  }

  return next;
};

class ProjectMetadataService {
  constructor({ basePath, registryPath } = {}) {
    const { getProjectsRoot, getAgentWorkspaceDir } = require('./utils/pathUtils');
    this.basePath = basePath || getProjectsRoot();
    this.registryPath = registryPath || path.join(getAgentWorkspaceDir(), 'project-metadata.json');
    this.cache = new Map();
    this.cacheMs = 60_000;
    this.registryCache = null;
    this.registryCacheAt = 0;
    this.registryCacheMs = 60_000;
  }

  static getInstance() {
    if (!ProjectMetadataService.instance) {
      ProjectMetadataService.instance = new ProjectMetadataService();
    }
    return ProjectMetadataService.instance;
  }

  getProjectKey(projectRoot) {
    const root = path.resolve(String(projectRoot || ''));
    const base = path.resolve(this.basePath);
    if (root === base) return '';
    if (root.startsWith(base + path.sep)) {
      return normalizeSlash(path.relative(base, root));
    }
    return normalizeSlash(root);
  }

  async loadRegistry({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.registryCache && (now - this.registryCacheAt) < this.registryCacheMs) {
      return this.registryCache;
    }

    try {
      const raw = await fs.readFile(this.registryPath, 'utf8');
      const parsed = JSON.parse(raw);
      const registry = {
        version: parsed?.version || 1,
        defaults: parsed?.defaults || {},
        projects: parsed?.projects || {}
      };
      this.registryCache = registry;
      this.registryCacheAt = now;
      return registry;
    } catch (error) {
      this.registryCache = { version: 1, defaults: {}, projects: {} };
      this.registryCacheAt = now;
      return this.registryCache;
    }
  }

  async loadCascadedProjectConfig(projectRoot) {
    const root = path.resolve(String(projectRoot || ''));
    const base = path.resolve(this.basePath);
    if (!root || !base || !root.startsWith(base)) return { merged: {}, sources: [] };

    const rel = path.relative(base, root);
    const segments = rel.split(path.sep).filter(Boolean);
    const sources = [];
    let merged = {};

    let current = base;
    for (const seg of segments) {
      current = path.join(current, seg);
      const { resolveRepoConfigPath } = require('./utils/pathUtils');
      const cfgPath = resolveRepoConfigPath(current);
      try {
        const raw = await fs.readFile(cfgPath, 'utf8');
        const cfg = JSON.parse(raw);
        if (cfg?.project && typeof cfg.project === 'object') {
          merged = mergeProjectMeta(merged, cfg.project);
          sources.push(cfgPath);
        }
      } catch {
        // ignore missing / invalid config files
      }
    }

    return { merged, sources };
  }

  async getForWorktree(worktreePath, { refresh = false } = {}) {
    const projectRoot = deriveProjectRootFromWorktreePath(worktreePath);
    const cacheKey = `proj:${projectRoot}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (!refresh && cached && (now - cached.at) < this.cacheMs) {
      return cached.data;
    }

    const projectKey = this.getProjectKey(projectRoot);
    const registry = await this.loadRegistry({ refresh });
    const defaults = registry?.defaults || {};
    const fromRegistry = (registry?.projects && projectKey && registry.projects[projectKey]) ? registry.projects[projectKey] : null;

    const cascaded = await this.loadCascadedProjectConfig(projectRoot);

    let meta = mergeProjectMeta({}, { baseImpactRisk: defaults.baseImpactRisk || DEFAULT_RISK });
    meta = mergeProjectMeta(meta, cascaded.merged);
    meta = mergeProjectMeta(meta, fromRegistry || {});

    const result = {
      projectRoot,
      projectKey,
      baseImpactRisk: meta.baseImpactRisk || DEFAULT_RISK,
      isLive: !!meta.isLive,
      prodUrl: meta.prodUrl || '',
      displayName: meta.displayName || '',
      aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
      sources: {
        registryPath: fromRegistry ? this.registryPath : null,
        configFiles: cascaded.sources
      }
    };

    this.cache.set(cacheKey, { at: now, data: result });
    return result;
  }
}

module.exports = { ProjectMetadataService, deriveProjectRootFromWorktreePath };

