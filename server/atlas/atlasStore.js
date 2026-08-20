const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');
const { SCHEMA_VERSION, kebab, normalizeEntry } = require('./atlasSchema');

const MANIFEST_FILENAME = '.repo-atlas.json';
const MANIFEST_SEARCH_SUBDIRS = ['', 'master', 'main'];
const DISCOVERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CONFIG_FILENAME = 'atlas.config.json';
const LEGACY_REGISTRY_FILENAME = 'registry.json';

function atlasDir() {
  const override = String(process.env.AGENT_WORKSPACE_ATLAS_DIR || '').trim();
  return override ? path.resolve(override) : path.join(getAgentWorkspaceDir(), 'atlas');
}

/**
 * The portable half of the atlas — your judgement about repos, which is the
 * same on every machine you work from and is what belongs in git.
 */
function registryDir() {
  return path.join(atlasDir(), 'registry');
}

/**
 * One file per curated repo. This is the detail that makes multi-machine sync
 * work: two machines curating different repos touch different files, so git
 * merges them without a conflict. A single registry.json would collide on
 * every concurrent edit.
 */
function entriesDir() {
  return path.join(registryDir(), 'entries');
}

function configPath() {
  return path.join(registryDir(), CONFIG_FILENAME);
}

function legacyRegistryPath() {
  return path.join(atlasDir(), LEGACY_REGISTRY_FILENAME);
}

// Machine-local: what this particular computer happens to have cloned. Never
// synced — it would be wrong on every other machine.
function discoveryCachePath() {
  return path.join(atlasDir(), 'discovery.json');
}

function bundlesDir() {
  return path.join(atlasDir(), 'bundles');
}

function subscriptionsDir() {
  return path.join(atlasDir(), 'subscriptions');
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
  // Write-then-rename so a crash mid-write can't leave a truncated file. The
  // registry is git-synced, so a corrupted half-write would otherwise be
  // committed and propagated to every other machine. rename is atomic on the
  // same filesystem; the pid keeps concurrent writers from sharing a temp path.
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

function emptyRegistry() {
  return {
    schemaVersion: SCHEMA_VERSION,
    scanRoots: [],
    audiences: [],
    remote: '',
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
    // Where compiled bundles for this audience get published — a path inside a
    // repo that audience already has access to.
    outputPath: String(raw?.outputPath || '').trim(),
    // Optional git repo to commit that bundle into.
    outputRemote: String(raw?.outputRemote || '').trim()
  };
}

function loadConfig() {
  const raw = readJson(configPath(), null) || readJson(legacyRegistryPath(), null) || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    scanRoots: Array.isArray(raw.scanRoots) ? raw.scanRoots.map(String).filter(Boolean) : [],
    audiences: (Array.isArray(raw.audiences) ? raw.audiences : []).map(normalizeAudience).filter(Boolean),
    remote: String(raw.remote || '').trim(),
    defaults: {
      visibility: String(raw?.defaults?.visibility || 'private'),
      groups: Array.isArray(raw?.defaults?.groups) ? raw.defaults.groups.map(kebab).filter(Boolean) : []
    }
  };
}

function saveConfig(config) {
  return writeJson(configPath(), {
    schemaVersion: SCHEMA_VERSION,
    scanRoots: config?.scanRoots || [],
    audiences: (config?.audiences || []).map(normalizeAudience).filter(Boolean),
    remote: String(config?.remote || '').trim(),
    defaults: config?.defaults || { visibility: 'private', groups: [] }
  });
}

function entryPath(id) {
  return path.join(entriesDir(), `${kebab(id)}.json`);
}

function loadEntries() {
  const entries = {};

  let files = [];
  try {
    files = fs.readdirSync(entriesDir()).filter((name) => name.endsWith('.json'));
  } catch {
    files = [];
  }

  for (const file of files) {
    const raw = readJson(path.join(entriesDir(), file), null);
    const id = kebab(raw?.id || path.basename(file, '.json'));
    if (!id) continue;
    entries[id] = { ...normalizeEntry({ ...raw, id }), id };
  }

  return entries;
}

/**
 * Fold a pre-split `registry.json` into per-entry files. Runs once, keeps the
 * old file as a backup, and is a no-op afterwards.
 */
function migrateLegacyRegistry() {
  const legacy = readJson(legacyRegistryPath(), null);
  if (!legacy) return { migrated: 0 };
  if (fs.existsSync(configPath())) return { migrated: 0, reason: 'already migrated' };

  ensureDir(entriesDir());
  let migrated = 0;
  for (const [key, value] of Object.entries(legacy.entries || {})) {
    const id = kebab(value?.id || key);
    if (!id) continue;
    writeJson(entryPath(id), { ...normalizeEntry({ ...value, id }), id });
    migrated += 1;
  }

  saveConfig({
    scanRoots: legacy.scanRoots || [],
    audiences: legacy.audiences || [],
    remote: legacy.remote || '',
    defaults: legacy.defaults
  });

  try {
    fs.renameSync(legacyRegistryPath(), `${legacyRegistryPath()}.migrated`);
  } catch {
    // Keeping the original in place is harmless — config presence gates re-runs.
  }

  return { migrated };
}

function loadRegistry() {
  migrateLegacyRegistry();
  const config = loadConfig();
  return { ...emptyRegistry(), ...config, entries: loadEntries() };
}

function saveRegistry(registry) {
  saveConfig(registry);
  for (const [id, entry] of Object.entries(registry?.entries || {})) {
    writeJson(entryPath(id), { ...entry, id });
  }
  return registryDir();
}

function upsertRegistryEntry(id, patch) {
  const key = kebab(id);
  if (!key) throw new Error('An atlas entry needs an id');

  migrateLegacyRegistry();
  const existing = readJson(entryPath(key), null) || { id: key };
  const next = { ...existing, ...normalizeEntry({ ...patch, id: key }), id: key };
  writeJson(entryPath(key), next);
  return next;
}

function removeRegistryEntry(id) {
  const target = entryPath(id);
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
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
  // Worktree layouts collapse to the parent dir during discovery, but the
  // manifest must land inside the checkout (master/ or main/) — the parent is
  // not a git repo, so a manifest written there could never be committed.
  const checkout = ['master', 'main']
    .map((dir) => path.join(projectRoot, dir))
    .find((candidate) => fs.existsSync(candidate));
  return writeJson(path.join(checkout || projectRoot, MANIFEST_FILENAME), entry);
}

function saveBundle(audienceId, bundle, outputPath = '') {
  const written = [writeJson(path.join(bundlesDir(), `atlas.${kebab(audienceId)}.json`), bundle)];
  if (outputPath) written.push(writeJson(path.resolve(outputPath), bundle));
  return written;
}

/**
 * Bundles published by other people. Read-only, lowest precedence, and always
 * attributed — a teammate's map should never silently overwrite your own notes.
 */
function loadSubscriptions() {
  let files = [];
  try {
    files = fs.readdirSync(subscriptionsDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  const bundles = [];
  for (const file of files) {
    const raw = readJson(path.join(subscriptionsDir(), file), null);
    if (!raw || !Array.isArray(raw.entries)) continue;
    bundles.push({
      name: path.basename(file, '.json'),
      audience: raw.audience || '',
      generatedAt: raw.generatedAt || null,
      entries: raw.entries
    });
  }
  return bundles;
}

function saveSubscription(name, bundle) {
  return writeJson(path.join(subscriptionsDir(), `${kebab(name)}.json`), bundle);
}

function removeSubscription(name) {
  const target = path.join(subscriptionsDir(), `${kebab(name)}.json`);
  if (!fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}

module.exports = {
  MANIFEST_FILENAME,
  CONFIG_FILENAME,
  DISCOVERY_CACHE_TTL_MS,
  atlasDir,
  registryDir,
  entriesDir,
  configPath,
  legacyRegistryPath,
  registryPath: configPath,
  discoveryCachePath,
  bundlesDir,
  subscriptionsDir,
  emptyRegistry,
  loadConfig,
  saveConfig,
  loadEntries,
  entryPath,
  migrateLegacyRegistry,
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
  loadSubscriptions,
  saveSubscription,
  removeSubscription,
  readJson,
  writeJson
};
