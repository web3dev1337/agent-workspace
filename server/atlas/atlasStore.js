const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');
const { SCHEMA_VERSION, kebab, normalizeEntry } = require('./atlasSchema');

const MANIFEST_FILENAME = '.repo-atlas.json';
const MANIFEST_SEARCH_SUBDIRS = ['', 'master', 'main'];
const DISCOVERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function atlasDir() {
  const override = String(process.env.AGENT_WORKSPACE_ATLAS_DIR || '').trim();
  return override ? path.resolve(override) : path.join(getAgentWorkspaceDir(), 'atlas');
}

function registryPath() {
  return path.join(atlasDir(), 'registry.json');
}

function discoveryCachePath() {
  return path.join(atlasDir(), 'discovery.json');
}

function bundlesDir() {
  return path.join(atlasDir(), 'bundles');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function emptyRegistry() {
  return {
    schemaVersion: SCHEMA_VERSION,
    scanRoots: [],
    audiences: [],
    defaults: { visibility: 'private', groups: [] },
    entries: {}
  };
}

function normalizeAudience(raw) {
  const id = kebab(raw?.id || raw);
  if (!id) return null;
  return {
    id,
    label: String(raw?.label || id).trim(),
    description: String(raw?.description || '').trim(),
    // Where compiled bundles for this audience should be copied, if anywhere.
    outputPath: String(raw?.outputPath || '').trim()
  };
}

function loadRegistry() {
  const raw = readJson(registryPath(), null);
  if (!raw) return emptyRegistry();

  const registry = emptyRegistry();
  registry.scanRoots = Array.isArray(raw.scanRoots) ? raw.scanRoots.map(String).filter(Boolean) : [];
  registry.audiences = (Array.isArray(raw.audiences) ? raw.audiences : []).map(normalizeAudience).filter(Boolean);
  registry.defaults = {
    visibility: String(raw?.defaults?.visibility || 'private'),
    groups: Array.isArray(raw?.defaults?.groups) ? raw.defaults.groups.map(kebab).filter(Boolean) : []
  };

  const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
  for (const [key, value] of Object.entries(entries)) {
    const id = kebab(value?.id || key);
    if (!id) continue;
    registry.entries[id] = { ...normalizeEntry({ ...value, id }), id };
  }

  return registry;
}

function saveRegistry(registry) {
  const next = {
    schemaVersion: SCHEMA_VERSION,
    scanRoots: registry?.scanRoots || [],
    audiences: (registry?.audiences || []).map(normalizeAudience).filter(Boolean),
    defaults: registry?.defaults || { visibility: 'private', groups: [] },
    entries: registry?.entries || {}
  };
  return writeJson(registryPath(), next);
}

function upsertRegistryEntry(id, patch) {
  const registry = loadRegistry();
  const key = kebab(id);
  if (!key) throw new Error('An atlas entry needs an id');
  const existing = registry.entries[key] || { id: key };
  registry.entries[key] = { ...existing, ...normalizeEntry({ ...patch, id: key }), id: key };
  saveRegistry(registry);
  return registry.entries[key];
}

function removeRegistryEntry(id) {
  const registry = loadRegistry();
  const key = kebab(id);
  const existed = Boolean(registry.entries[key]);
  delete registry.entries[key];
  saveRegistry(registry);
  return existed;
}

function loadDiscoveryCache({ maxAgeMs = DISCOVERY_CACHE_TTL_MS } = {}) {
  const cached = readJson(discoveryCachePath(), null);
  if (!cached || !Array.isArray(cached.entries)) return null;
  const generatedMs = Date.parse(String(cached.generatedAt || ''));
  if (!Number.isFinite(generatedMs)) return null;
  if (Date.now() - generatedMs > maxAgeMs) return { ...cached, stale: true };
  return { ...cached, stale: false };
}

function saveDiscoveryCache(entries, meta = {}) {
  return writeJson(discoveryCachePath(), {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...meta,
    entries
  });
}

function manifestPathFor(projectRoot) {
  for (const subdir of MANIFEST_SEARCH_SUBDIRS) {
    const candidate = path.join(projectRoot, subdir, MANIFEST_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Read the in-repo manifest for a discovered repo. A repo describing itself is
 * always more current than anything cached centrally, so this is a live read.
 */
function loadManifest(projectRoot) {
  if (!projectRoot) return null;
  const filePath = manifestPathFor(projectRoot);
  if (!filePath) return null;
  const raw = readJson(filePath, null);
  if (!raw) return null;
  return { ...normalizeEntry(raw), __source: 'manifest', __manifestPath: filePath };
}

function writeManifest(projectRoot, entry) {
  const target = fs.existsSync(path.join(projectRoot, 'master'))
    ? path.join(projectRoot, 'master')
    : projectRoot;
  return writeJson(path.join(target, MANIFEST_FILENAME), entry);
}

function saveBundle(audienceId, bundle, outputPath = '') {
  const written = [writeJson(path.join(bundlesDir(), `atlas.${kebab(audienceId)}.json`), bundle)];
  if (outputPath) written.push(writeJson(path.resolve(outputPath), bundle));
  return written;
}

module.exports = {
  MANIFEST_FILENAME,
  DISCOVERY_CACHE_TTL_MS,
  atlasDir,
  registryPath,
  discoveryCachePath,
  bundlesDir,
  emptyRegistry,
  loadRegistry,
  saveRegistry,
  upsertRegistryEntry,
  removeRegistryEntry,
  loadDiscoveryCache,
  saveDiscoveryCache,
  manifestPathFor,
  loadManifest,
  writeManifest,
  saveBundle,
  readJson,
  writeJson
};
