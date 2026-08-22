const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

const KINDS = ['game', 'library', 'tool', 'website', 'service', 'reference', 'writing', 'experiment', 'infra', 'other'];
const STATUSES = ['active', 'paused', 'prototype', 'archived', 'abandoned'];
const MATURITIES = ['production', 'beta', 'prototype', 'experiment'];
const VISIBILITIES = ['public', 'team', 'private', 'encrypted'];
const DIMENSIONS = ['2d', '3d', 'mixed', 'n/a'];
const REDACTABLE_FIELDS = ['summary', 'notes', 'paths', 'highlights', 'avoid', 'seeAlso', 'tags'];

// visibility: 'encrypted' entries: everything here is the judgement content
// that gets sealed behind the repo key. `id`/`name`/`repo`/`owner`/`kind`
// stay in clear text on purpose — a reader needs to know which repo's key to
// try, and "a locked entry exists for this repo" is not itself a secret.
const ENCRYPTED_FIELDS = [
  'summary', 'status', 'maturity', 'dimension', 'platforms', 'languages',
  'tags', 'quality', 'highlights', 'avoid', 'seeAlso', 'lastActivity'
];

// Never leave this machine in a compiled bundle: absolute paths expose the
// local user/folder layout and say nothing useful to anyone else.
const LOCAL_ONLY_FIELDS = ['localPath', 'cloned', 'worktreeLayout', 'lastScannedAt'];

const TOPICS_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'repo-atlas-topics.json');

let topicIndexCache = null;

function loadTopicIndex() {
  if (topicIndexCache) return topicIndexCache;

  const index = { canonical: new Map(), labels: new Map() };
  try {
    const raw = JSON.parse(fs.readFileSync(TOPICS_CONFIG_PATH, 'utf8'));
    for (const topic of Array.isArray(raw?.topics) ? raw.topics : []) {
      const id = kebab(topic?.id);
      if (!id) continue;
      index.canonical.set(id, id);
      index.labels.set(id, String(topic?.label || id));
      for (const alias of Array.isArray(topic?.aliases) ? topic.aliases : []) {
        const key = kebab(alias);
        if (key) index.canonical.set(key, id);
      }
    }
  } catch {
    // A missing or broken vocabulary must never stop the atlas from working.
  }

  topicIndexCache = index;
  return index;
}

function resetTopicIndexCache() {
  topicIndexCache = null;
}

function kebab(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeTopic(value) {
  const key = kebab(value);
  if (!key) return '';
  return loadTopicIndex().canonical.get(key) || key;
}

function topicLabel(topicId) {
  return loadTopicIndex().labels.get(topicId) || topicId;
}

function listCanonicalTopics() {
  const index = loadTopicIndex();
  return [...index.labels.entries()].map(([id, label]) => ({ id, label }));
}

function oneOf(value, allowed, fallback) {
  const key = String(value || '').trim().toLowerCase();
  return allowed.includes(key) ? key : fallback;
}

function stringList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  for (const item of source) {
    const text = String(item || '').trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function slugList(value) {
  const out = [];
  for (const item of stringList(value)) {
    const slug = kebab(item);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

function qualityScore(value) {
  // `Number(null)` and `Number('')` are 0, which would clamp to 1 — silently
  // turning an intentionally-unscored highlight ("no opinion yet") into the
  // worst possible score. Unscored must stay null; only real numbers clamp
  // (an explicit out-of-range 0 still floors to 1).
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(5, Math.max(1, Math.round(num)));
}

function isoDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeHighlight(raw) {
  const topic = normalizeTopic(raw?.topic || raw?.name);
  if (!topic) return null;
  return {
    topic,
    quality: qualityScore(raw?.quality),
    paths: stringList(raw?.paths || raw?.path),
    notes: String(raw?.notes || raw?.note || '').trim()
  };
}

function normalizeAvoid(raw) {
  const topic = normalizeTopic(raw?.topic || raw?.name);
  if (!topic) return null;
  return { topic, reason: String(raw?.reason || raw?.notes || '').trim() };
}

/**
 * One entry per topic, last write wins. Later entries are corrections — if you
 * say testing is a 5 and then a 2, you mean 2.
 */
function normalizeList(value, normalizer) {
  const byTopic = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = normalizer(item);
    if (normalized) byTopic.set(normalized.topic, normalized);
  }
  return [...byTopic.values()];
}

function normalizeGroupOverrides(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [group, override] of Object.entries(value)) {
    const key = kebab(group);
    if (!key || !override || typeof override !== 'object') continue;
    const entry = {};
    if (override.redact !== undefined) {
      entry.redact = slugList(override.redact).filter((f) => REDACTABLE_FIELDS.includes(f));
    }
    if (override.summary !== undefined) entry.summary = String(override.summary || '').trim();
    if (override.highlights !== undefined) entry.highlights = normalizeList(override.highlights, normalizeHighlight);
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

/**
 * Normalize any partial atlas entry into the canonical shape.
 * `strict: false` (the default) keeps only the keys the caller actually
 * supplied, which is what makes layered merging meaningful.
 */
function normalizeEntry(raw = {}, { strict = false } = {}) {
  const has = (key) => raw && Object.prototype.hasOwnProperty.call(raw, key);
  const entry = {};

  const id = kebab(raw?.id || raw?.name || raw?.repo);
  if (id) entry.id = id;

  if (strict || has('name')) entry.name = String(raw?.name || raw?.id || '').trim();
  if (strict || has('repo') || has('nameWithOwner')) {
    entry.repo = String(raw?.repo || raw?.nameWithOwner || '').trim();
  }
  if (strict || has('owner')) entry.owner = String(raw?.owner || '').trim();
  if (strict || has('summary')) entry.summary = String(raw?.summary || raw?.description || '').trim();
  if (strict || has('description')) entry.summary = entry.summary || String(raw?.description || '').trim();

  if (strict || has('kind')) entry.kind = oneOf(raw?.kind, KINDS, 'other');
  if (strict || has('status')) entry.status = oneOf(raw?.status, STATUSES, 'active');
  if (strict || has('maturity')) entry.maturity = oneOf(raw?.maturity, MATURITIES, 'prototype');
  if (strict || has('visibility')) entry.visibility = oneOf(raw?.visibility, VISIBILITIES, 'private');
  if (strict || has('dimension')) entry.dimension = oneOf(raw?.dimension, DIMENSIONS, 'n/a');

  if (strict || has('platforms') || has('platform')) entry.platforms = slugList(raw?.platforms || raw?.platform);
  if (strict || has('languages') || has('language')) entry.languages = stringList(raw?.languages || raw?.language);
  if (strict || has('tags')) entry.tags = slugList(raw?.tags);
  if (strict || has('groups') || has('group')) entry.groups = slugList(raw?.groups || raw?.group);
  if (strict || has('seeAlso')) entry.seeAlso = slugList(raw?.seeAlso);

  if (strict || has('quality')) entry.quality = qualityScore(raw?.quality);
  if (strict || has('highlights')) entry.highlights = normalizeList(raw?.highlights, normalizeHighlight);
  if (has('highlightsAdd')) entry.highlightsAdd = normalizeList(raw?.highlightsAdd, normalizeHighlight);
  if (strict || has('avoid')) entry.avoid = normalizeList(raw?.avoid, normalizeAvoid);

  if (strict || has('redact')) {
    entry.redact = slugList(raw?.redact).filter((field) => REDACTABLE_FIELDS.includes(field));
  }
  if (strict || has('groupOverrides')) entry.groupOverrides = normalizeGroupOverrides(raw?.groupOverrides);

  if (strict || has('localPath')) entry.localPath = String(raw?.localPath || '').trim() || null;
  if (strict || has('cloned')) entry.cloned = raw?.cloned === true;
  if (strict || has('remoteUrl')) entry.remoteUrl = String(raw?.remoteUrl || '').trim();
  if (strict || has('isFork')) entry.isFork = raw?.isFork === true;
  if (strict || has('archived')) entry.archived = raw?.archived === true;
  if (strict || has('worktreeLayout')) entry.worktreeLayout = raw?.worktreeLayout === true;
  if (strict || has('lastActivity')) entry.lastActivity = isoDate(raw?.lastActivity);
  if (strict || has('lastScannedAt')) entry.lastScannedAt = isoDate(raw?.lastScannedAt);

  // A sealed entry (visibility: encrypted, no repo key resolved yet) — the
  // ciphertext blob for the fields listed in ENCRYPTED_FIELDS. Must survive
  // mergeEntries' final strict normalize or a locked entry loses its payload
  // the moment it is layered in from a subscription.
  if (strict || has('encrypted')) {
    entry.encrypted = (raw?.encrypted && typeof raw.encrypted === 'object') ? raw.encrypted : null;
  }

  if (strict && !entry.name) entry.name = entry.id || '';

  return entry;
}

/**
 * Layer entries lowest-precedence first. Present keys win; absent keys are
 * left alone, so a registry override only has to state what it disagrees with.
 */
function mergeEntries(...layers) {
  const merged = {};
  const sources = [];

  for (const layer of layers) {
    if (!layer) continue;
    const { __source: source, highlightsAdd, ...fields } = layer;
    if (source && !sources.includes(source)) sources.push(source);

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (value === null && merged[key] !== undefined && merged[key] !== null) continue;
      if (Array.isArray(value) && value.length === 0 && Array.isArray(merged[key]) && merged[key].length) continue;
      if (typeof value === 'string' && value === '' && merged[key]) continue;
      merged[key] = value;
    }

    // Layers may arrive raw (a manifest read straight off disk), so additions
    // are normalized here rather than trusting the caller to have done it.
    const additions = normalizeList(highlightsAdd, normalizeHighlight);
    if (additions.length) {
      const existing = Array.isArray(merged.highlights) ? merged.highlights : [];
      merged.highlights = normalizeList([...existing, ...additions], normalizeHighlight);
    }
  }

  const normalized = normalizeEntry(merged, { strict: true });
  normalized.sources = sources;
  return normalized;
}

function validateEntry(entry) {
  const errors = [];
  const warnings = [];

  if (!entry?.id) errors.push('missing id');
  if (!VISIBILITIES.includes(entry?.visibility)) errors.push(`invalid visibility "${entry?.visibility}"`);
  if (entry?.visibility === 'team' && !(entry?.groups || []).length) {
    warnings.push('visibility "team" with no groups — this entry lands in no bundle');
  }
  if (!entry?.summary) warnings.push('no summary — agents get very little from this entry');
  if (!(entry?.highlights || []).length) warnings.push('no highlights — nothing for an agent to be pointed at');

  for (const highlight of entry?.highlights || []) {
    if (highlight.quality === null) warnings.push(`highlight "${highlight.topic}" has no quality score`);
  }
  for (const field of entry?.redact || []) {
    if (!REDACTABLE_FIELDS.includes(field)) errors.push(`cannot redact unknown field "${field}"`);
  }

  return { id: entry?.id || '(unknown)', ok: errors.length === 0, errors, warnings };
}

module.exports = {
  SCHEMA_VERSION,
  KINDS,
  STATUSES,
  MATURITIES,
  VISIBILITIES,
  DIMENSIONS,
  REDACTABLE_FIELDS,
  ENCRYPTED_FIELDS,
  LOCAL_ONLY_FIELDS,
  kebab,
  normalizeTopic,
  topicLabel,
  listCanonicalTopics,
  resetTopicIndexCache,
  normalizeEntry,
  mergeEntries,
  validateEntry
};
