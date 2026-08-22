const os = require('os');
const path = require('path');

const schema = require('./atlas/atlasSchema');
const store = require('./atlas/atlasStore');
const discovery = require('./atlas/atlasDiscovery');
const query = require('./atlas/atlasQuery');
const compiler = require('./atlas/atlasCompiler');
const encryption = require('./atlas/atlasEncryption');
const sync = require('./atlas/atlasSync');
const proposals = require('./atlas/atlasProposals');
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

    // Bundles other people published sit underneath everything: their map is
    // useful, but your own discovery and judgement always win over it.
    for (const bundle of store.loadSubscriptions()) {
      for (const entry of bundle.entries) {
        if (!entry?.id) continue;
        const slot = byId.get(entry.id) || {};
        slot.subscription = {
          ...entry,
          __source: 'subscription',
          foreign: true,
          sharedBy: bundle.name,
          cloned: false,
          localPath: null
        };
        byId.set(entry.id, slot);
      }
    }

    for (const entry of discovered) {
      if (!entry?.id) continue;
      const slot = byId.get(entry.id) || {};
      slot.discovery = { ...entry, __source: 'discovery' };
      byId.set(entry.id, slot);
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
        layers.subscription,
        layers.discovery,
        layers.manifest,
        layers.registry
      );
      // Foreign = it only exists here because a teammate shared it. A local
      // registry note (annotating their entry for your own searches) must NOT
      // declassify it — otherwise compile() would re-publish their inherited
      // fields under your bundle, breaking the "never re-share" guarantee. Only
      // actually having the repo locally (discovery) makes it yours to share.
      if (layers.subscription && !layers.discovery) {
        merged.foreign = true;
        merged.sharedBy = layers.subscription.sharedBy;
      }
      merged.id = id;
      merged.sources = (merged.sources || []).filter((s) => s !== 'defaults');
      // Opportunistic, no-network unlock: if a key for this repo is already
      // cached (or this machine happens to have the repo cloned too), decrypt
      // right here so every reader — find/show/digest — just sees the entry.
      // A key that only exists over `gh api` needs an explicit
      // `unlockEncrypted()` / `atlas key sync` first; getEntries() never
      // makes network calls.
      entries.push(encryption.decryptIfPossible(merged));
    }

    entries.sort((a, b) => a.id.localeCompare(b.id));
    this.cache = entries;
    this.cachedAt = Date.now();
    return entries;
  }

  /**
   * Entries as YOU may share them: merged WITHOUT the subscription layer, so a
   * teammate's highlights/summary can never ride into a bundle you compile.
   * The `foreign` flag alone is not enough — it clears the moment discovery
   * also knows the repo (you cloned it, or `gh` can list it), and cloning a
   * repo someone shared with you must not declassify THEIR judgement of it.
   * Entries whose existence you only know from a subscription (even if you
   * annotated them locally) are skipped outright.
   */
  getOwnEntries() {
    const { byId, registry } = this.loadLayers();
    const entries = [];

    for (const [id, layers] of byId.entries()) {
      if (layers.subscription && !layers.discovery && !layers.manifest) continue;
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

  setAudience({ id, label = '', description = '', outputPath = '', outputRemote = '' } = {}) {
    const config = store.loadConfig();
    const key = schema.kebab(id);
    if (!key) throw new Error('An audience needs an id');
    const audiences = (config.audiences || []).filter((a) => a.id !== key);
    audiences.push({ id: key, label: label || key, description, outputPath, outputRemote });
    config.audiences = audiences;
    store.saveConfig(config);
    this.invalidate();
    return audiences;
  }

  compile(audience, { write = true } = {}) {
    const meta = this.listAudiences().find((a) => a.id === schema.kebab(audience)) || {};
    // Never re-share what someone else shared with you — attribution and
    // permission both belong to whoever published it. getOwnEntries() merges
    // without the subscription layer, so this holds even for a subscribed
    // repo you later cloned (the old `foreign` filter alone let that case
    // republish the teammate's fields as if they were yours).
    const own = this.getOwnEntries().filter((entry) => entry.foreign !== true);
    const repoKeys = encryption.resolveKeysForPublish(own, { logger: this.logger });
    const result = compiler.compileBundle(own, {
      audience,
      label: meta.label,
      description: meta.description,
      repoKeys
    });
    result.written = write ? store.saveBundle(audience, result.bundle, meta.outputPath) : [];
    return result;
  }

  /**
   * Pull, merge and push the registry. This is what makes the atlas survive
   * working across machines — and survive the machine.
   */
  async sync(options = {}) {
    const result = await sync.syncRegistry(options);
    this.invalidate();
    return result;
  }

  async setRemote(remote) {
    const value = await sync.setRemote(remote);
    this.invalidate();
    return value;
  }

  async getSyncStatus() {
    return sync.getSyncStatus();
  }

  /**
   * Publish an audience bundle into a repo that audience already has access to.
   */
  async publish(audience, { push = true } = {}) {
    const meta = this.listAudiences().find((a) => a.id === schema.kebab(audience));
    if (!meta) throw new Error(`Unknown audience "${audience}" — add it with \`atlas audience add ${audience}\``);

    const compiled = this.compile(audience, { write: true });
    const published = push
      ? await sync.publishBundle({
        audience: meta.id,
        bundle: compiled.bundle,
        outputPath: meta.outputPath,
        outputRemote: meta.outputRemote
      })
      : { ok: true, committed: false, path: meta.outputPath || compiled.written[0], detail: 'push disabled' };

    return { ...compiled, published };
  }

  async subscribe({ name, source }) {
    const result = await sync.subscribe({ name, source });
    this.invalidate();
    // Anything this machine can already decrypt without the network (cached
    // key, or a local clone with `.repo-atlas-key`) unlocks for free on the
    // very next getEntries() read — see decryptIfPossible() there. A key
    // that only exists via `gh api` needs an explicit `atlas key sync`
    // (unlockEncrypted()) — subscribe() itself never makes network calls,
    // matching the rest of the CLI ("no network unless you ask it to").
    return result;
  }

  /**
   * Generate (or rotate) the repo key for one of YOUR entries. Requires a
   * local clone — the key has to land in `.repo-atlas-key` in that repo for
   * anyone to ever find it. Refuses to clobber an existing key unless you
   * explicitly ask for a rotation, since rotating breaks decrypt for every
   * bundle already compiled with the old key.
   */
  generateRepoKey(id, { rotate = false } = {}) {
    const entry = this.getOwnEntries().find((e) => e.id === schema.kebab(id));
    if (!entry) throw new Error(`no repo "${id}" on the map (or it is not yours to key — try \`atlas list\`)`);
    if (!entry.cloned || !entry.localPath) {
      throw new Error(`"${id}" is not cloned locally — a repo key has to live inside the repo it protects`);
    }

    const repoId = entry.repo || entry.id;
    const existing = store.readRepoKey(entry.localPath);
    if (existing && !rotate) {
      store.saveCachedRepoKey(repoId, existing);
      store.saveCachedRepoKey(entry.id, existing);
      return { id: entry.id, key: existing, generated: false, path: store.keyPathFor(entry.localPath) };
    }

    const key = rotate ? encryption.rotateKeyForPublish(entry) : encryption.generateKey();
    const writtenPath = rotate ? store.keyPathFor(entry.localPath) : store.writeRepoKey(entry.localPath, key);
    store.saveCachedRepoKey(repoId, key);
    store.saveCachedRepoKey(entry.id, key);

    return { id: entry.id, key, generated: true, rotated: rotate, path: writtenPath };
  }

  /**
   * Read-only key lookup — never generates or writes anything. Checks the
   * local cache, then a local clone if this machine has one.
   */
  getRepoKey(id) {
    const entry = this.getEntry(id);
    if (!entry) return null;
    return encryption.resolveKeyLocal(entry);
  }

  /**
   * Resolve keys, over the network if needed, for every currently-locked
   * encrypted entry this machine can see. Call after `atlas subscribe`, or
   * on demand as `atlas key sync` once someone grants you repo access.
   */
  async unlockEncrypted({ fetchKey } = {}) {
    const locked = this.getEntries({ force: true }).filter((entry) => entry.visibility === 'encrypted' && entry.locked);
    let unlocked = 0;
    const stillLocked = [];

    for (const entry of locked) {
      // eslint-disable-next-line no-await-in-loop
      const key = await encryption.resolveKeyRemote(entry, fetchKey ? { fetchKey } : {});
      if (key) unlocked += 1;
      else stillLocked.push(entry.id);
    }

    if (unlocked) this.invalidate();
    return { checked: locked.length, unlocked, stillLocked };
  }

  /**
   * Write-back: an agent that just finished work proposes what it learned, and
   * the proposal waits for you. This is what keeps the map current instead of
   * letting it rot into another stale doc.
   */
  proposeHighlight(input) {
    return proposals.propose(input);
  }

  listProposals(filters = {}) {
    return proposals.list(filters);
  }

  approveProposal(id, options = {}) {
    const result = proposals.approve(id, this, options);
    this.invalidate();
    return result;
  }

  rejectProposal(id, options = {}) {
    return proposals.reject(id, options);
  }

  clearDecidedProposals() {
    return proposals.clearDecided();
  }

  getProposalStats() {
    return proposals.getStats();
  }

  listSubscriptions() {
    return store.loadSubscriptions().map((bundle) => ({
      name: bundle.name,
      audience: bundle.audience,
      generatedAt: bundle.generatedAt,
      entryCount: bundle.entries.length
    }));
  }

  unsubscribe(name) {
    const removed = store.removeSubscription(name);
    this.invalidate();
    return removed;
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
      registryDir: store.registryDir(),
      scanRoots: this.getScanRoots(),
      entryCount: entries.length,
      clonedCount: entries.filter((e) => e.cloned).length,
      foreignCount: entries.filter((e) => e.foreign).length,
      curatedCount: Object.keys(store.loadEntries()).length,
      highlightCount: entries.reduce((sum, e) => sum + (e.highlights || []).length, 0),
      lockedCount: entries.filter((e) => e.visibility === 'encrypted' && e.locked).length,
      audiences: this.listAudiences().map((a) => a.id),
      subscriptions: this.listSubscriptions(),
      proposals: proposals.getStats(),
      remote: store.loadConfig().remote || null,
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
module.exports.encryption = encryption;
module.exports.proposals = proposals;
module.exports.defaultScanRoots = defaultScanRoots;
