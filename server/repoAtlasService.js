const os = require('os');
const path = require('path');

const schema = require('./atlas/atlasSchema');
const store = require('./atlas/atlasStore');
const discovery = require('./atlas/atlasDiscovery');
const query = require('./atlas/atlasQuery');
const compiler = require('./atlas/atlasCompiler');
const { getProjectsRoot, getLegacyProjectsRoot } = require('./utils/pathUtils');

const ATLAS_CACHE_MS = 60_000;

function defaultScanRoots() {
  const roots = [getLegacyProjectsRoot(), getProjectsRoot(), path.join(os.homedir(), 'GitHub')];
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/**
 * The Repo Atlas: one queryable map of every repo you own, cloned or not.
 *
 * Entries are layered lowest-precedence first —
 *   discovery (what the machine can see)
 *     < manifest (what the repo says about itself, `.repo-atlas.json`)
 *       < registry (what you say about it, and you always win).
 */
class RepoAtlasService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.cache = null;
    this.cachedAt = 0;
  }

  static getInstance(options = {}) {
    if (!RepoAtlasService.instance) {
      RepoAtlasService.instance = new RepoAtlasService(options);
    }
    return RepoAtlasService.instance;
  }

  invalidate() {
    this.cache = null;
    this.cachedAt = 0;
  }

  getScanRoots() {
    const registry = store.loadRegistry();
    const configured = (registry.scanRoots || []).map((r) => path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())));
    return configured.length ? configured : defaultScanRoots();
  }

  /**
   * Re-run discovery against disk and GitHub, then cache it. Discovery is the
   * slow layer, so everything else reads from this snapshot.
   */
  async refresh({ scanLocal = true, scanGitHub = true, limit = 300, owner = '' } = {}) {
    const roots = this.getScanRoots();
    const localEntries = scanLocal ? await discovery.scanLocalRepos({ roots }) : [];
    const github = scanGitHub ? await discovery.listGitHubRepos({ limit, owner }) : { available: false, entries: [] };
    const merged = discovery.mergeDiscovery(localEntries, github.entries);

    store.saveDiscoveryCache(merged, {
      roots,
      localCount: localEntries.length,
      githubCount: github.entries.length,
      githubAvailable: github.available
    });
    this.invalidate();

    return {
      roots,
      localCount: localEntries.length,
      githubCount: github.entries.length,
      githubAvailable: github.available,
      totalCount: merged.length
    };
  }

  loadLayers() {
    const cached = store.loadDiscoveryCache({ maxAgeMs: Number.MAX_SAFE_INTEGER });
    const discovered = cached?.entries || [];
    const registry = store.loadRegistry();

    const byId = new Map();
    for (const entry of discovered) {
      if (!entry?.id) continue;
      byId.set(entry.id, { discovery: { ...entry, __source: 'discovery' } });
    }

    for (const entry of discovered) {
      if (!entry?.id || !entry.localPath) continue;
      const manifest = store.loadManifest(entry.localPath);
      if (manifest) byId.get(entry.id).manifest = manifest;
    }

    for (const [id, entry] of Object.entries(registry.entries || {})) {
      const slot = byId.get(id) || {};
      slot.registry = { ...entry, __source: 'registry' };
      byId.set(id, slot);
    }

    return { byId, registry, discoveryMeta: cached };
  }

  getEntries({ force = false } = {}) {
    if (!force && this.cache && Date.now() - this.cachedAt < ATLAS_CACHE_MS) return this.cache;

    const { byId, registry } = this.loadLayers();
    const entries = [];

    for (const [id, layers] of byId.entries()) {
      const merged = schema.mergeEntries(
        { id, visibility: registry.defaults?.visibility, groups: registry.defaults?.groups, __source: 'defaults' },
        layers.discovery,
        layers.manifest,
        layers.registry
      );
      merged.id = id;
      merged.sources = (merged.sources || []).filter((s) => s !== 'defaults');
      entries.push(merged);
    }

    entries.sort((a, b) => a.id.localeCompare(b.id));
    this.cache = entries;
    this.cachedAt = Date.now();
    return entries;
  }

  getEntry(id, options = {}) {
    const key = schema.kebab(id);
    return this.getEntries(options).find((entry) => entry.id === key) || null;
  }

  search(filters = {}) {
    return query.filterEntries(this.getEntries(), filters);
  }

  find(topic, options = {}) {
    return query.findByTopic(this.getEntries(), topic, options);
  }

  topics() {
    return query.topicIndex(this.getEntries());
  }

  digest(options = {}) {
    return query.buildDigest(this.getEntries(), options);
  }

  describe(id) {
    const entry = this.getEntry(id);
    return entry ? query.describeEntry(entry) : null;
  }

  /**
   * The single highest-value curation action: "remember that this repo did this
   * thing well." Everything else about an entry can stay auto-discovered.
   */
  addHighlight(id, { topic, quality = null, paths = [], notes = '' } = {}) {
    const normalizedTopic = schema.normalizeTopic(topic);
    if (!normalizedTopic) throw new Error('addHighlight requires a topic');

    const registry = store.loadRegistry();
    const key = schema.kebab(id);
    const existing = registry.entries[key] || { id: key };
    const highlights = (existing.highlights || []).filter((h) => h.topic !== normalizedTopic);
    highlights.push({
      topic: normalizedTopic,
      quality: quality === null ? null : Number(quality),
      paths: Array.isArray(paths) ? paths : String(paths || '').split(',').map((p) => p.trim()).filter(Boolean),
      notes: String(notes || '')
    });

    const saved = store.upsertRegistryEntry(key, { ...existing, highlights });
    this.invalidate();
    return saved;
  }

  addAvoid(id, { topic, reason = '' } = {}) {
    const normalizedTopic = schema.normalizeTopic(topic);
    if (!normalizedTopic) throw new Error('addAvoid requires a topic');

    const registry = store.loadRegistry();
    const key = schema.kebab(id);
    const existing = registry.entries[key] || { id: key };
    const avoid = (existing.avoid || []).filter((a) => a.topic !== normalizedTopic);
    avoid.push({ topic: normalizedTopic, reason: String(reason || '') });

    const saved = store.upsertRegistryEntry(key, { ...existing, avoid });
    this.invalidate();
    return saved;
  }

  setEntry(id, patch = {}) {
    const saved = store.upsertRegistryEntry(id, patch);
    this.invalidate();
    return saved;
  }

  removeEntry(id) {
    const removed = store.removeRegistryEntry(id);
    this.invalidate();
    return removed;
  }

  listAudiences() {
    return store.loadRegistry().audiences || [];
  }

  setAudience({ id, label = '', description = '', outputPath = '' } = {}) {
    const registry = store.loadRegistry();
    const key = schema.kebab(id);
    if (!key) throw new Error('An audience needs an id');
    const audiences = (registry.audiences || []).filter((a) => a.id !== key);
    audiences.push({ id: key, label: label || key, description, outputPath });
    registry.audiences = audiences;
    store.saveRegistry(registry);
    this.invalidate();
    return audiences;
  }

  compile(audience, { write = true } = {}) {
    const meta = this.listAudiences().find((a) => a.id === schema.kebab(audience)) || {};
    const result = compiler.compileBundle(this.getEntries(), {
      audience,
      label: meta.label,
      description: meta.description
    });
    result.written = write ? store.saveBundle(audience, result.bundle, meta.outputPath) : [];
    return result;
  }

  validate() {
    const entries = this.getEntries();
    const reports = entries.map((entry) => schema.validateEntry(entry));
    return {
      entryCount: entries.length,
      curatedCount: entries.filter((e) => (e.sources || []).some((s) => s === 'registry' || s === 'manifest')).length,
      withHighlights: entries.filter((e) => (e.highlights || []).length).length,
      errors: reports.filter((r) => !r.ok),
      warnings: reports.filter((r) => r.ok && r.warnings.length)
    };
  }

  initManifest(projectRoot, seed = {}) {
    const resolved = path.resolve(projectRoot);
    const existing = this.getEntries().find((entry) => entry.localPath === resolved);
    const draft = schema.normalizeEntry({
      id: seed.id || existing?.id || path.basename(resolved),
      name: seed.name || existing?.name || path.basename(resolved),
      summary: seed.summary || existing?.summary || '',
      kind: seed.kind || existing?.kind || 'other',
      platforms: seed.platforms || existing?.platforms || [],
      languages: seed.languages || existing?.languages || [],
      status: seed.status || existing?.status || 'active',
      maturity: seed.maturity || existing?.maturity || 'prototype',
      visibility: seed.visibility || 'private',
      groups: seed.groups || [],
      highlights: seed.highlights || [],
      avoid: seed.avoid || []
    }, { strict: true });

    delete draft.sources;
    return { path: store.writeManifest(resolved, draft), entry: draft };
  }

  getStatus() {
    const meta = store.loadDiscoveryCache({ maxAgeMs: store.DISCOVERY_CACHE_TTL_MS });
    const entries = this.getEntries();
    return {
      atlasDir: store.atlasDir(),
      registryPath: store.registryPath(),
      scanRoots: this.getScanRoots(),
      entryCount: entries.length,
      clonedCount: entries.filter((e) => e.cloned).length,
      highlightCount: entries.reduce((sum, e) => sum + (e.highlights || []).length, 0),
      audiences: this.listAudiences().map((a) => a.id),
      discovery: meta
        ? { generatedAt: meta.generatedAt, stale: meta.stale, githubAvailable: meta.githubAvailable !== false }
        : null
    };
  }
}

module.exports = RepoAtlasService;
module.exports.RepoAtlasService = RepoAtlasService;
module.exports.schema = schema;
module.exports.store = store;
module.exports.discovery = discovery;
module.exports.query = query;
module.exports.compiler = compiler;
module.exports.defaultScanRoots = defaultScanRoots;
