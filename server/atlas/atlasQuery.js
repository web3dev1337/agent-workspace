const { normalizeTopic, kebab } = require('./atlasSchema');

const STALE_AFTER_DAYS = 365;

// `null`, `''`, `undefined` and bare booleans all mean "no floor" — Number()
// turns them into 0, which would silently drop every uncurated repo.
function qualityFloor(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isStale(entry) {
  const ms = Date.parse(String(entry?.lastActivity || ''));
  if (!Number.isFinite(ms)) return false;
  return (Date.now() - ms) / 86_400_000 > STALE_AFTER_DAYS;
}

function matchesText(entry, query) {
  if (!query) return true;
  const needle = String(query).trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    entry.id, entry.name, entry.repo, entry.summary,
    ...(entry.tags || []), ...(entry.platforms || []), ...(entry.languages || []),
    ...(entry.highlights || []).flatMap((h) => [h.topic, h.notes])
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function filterEntries(entries, filters = {}) {
  const {
    kind = '', platform = '', group = '', status = '', language = '',
    query = '', includeForks = true, includeArchived = true, minQuality = null
  } = filters;

  const wantPlatform = kebab(platform);
  const wantGroup = kebab(group);
  const wantLanguage = String(language || '').trim().toLowerCase();
  const wantKind = String(kind || '').trim().toLowerCase();
  const wantStatus = String(status || '').trim().toLowerCase();
  const floor = qualityFloor(minQuality);

  return entries.filter((entry) => {
    if (wantKind && entry.kind !== wantKind) return false;
    if (wantStatus && entry.status !== wantStatus) return false;
    if (wantPlatform && !(entry.platforms || []).includes(wantPlatform)) return false;
    if (wantGroup && !(entry.groups || []).includes(wantGroup)) return false;
    if (wantLanguage && !(entry.languages || []).some((l) => l.toLowerCase() === wantLanguage)) return false;
    if (!includeForks && entry.isFork) return false;
    if (!includeArchived && (entry.archived || entry.status === 'archived')) return false;
    if (floor !== null) {
      const best = bestQuality(entry);
      if (best === null || best < floor) return false;
    }
    return matchesText(entry, query);
  });
}

function bestQuality(entry) {
  const scores = (entry.highlights || []).map((h) => h.quality).filter((q) => Number.isFinite(q));
  if (entry.quality) scores.push(entry.quality);
  if (!scores.length) return null;
  return Math.max(...scores);
}

/**
 * Topic lookup is the load-bearing query: "who did X well?". Results are ranked
 * by highlight quality, then recency, so the top answer is the one worth reading.
 */
function findByTopic(entries, topic, { minQuality = null, includeAvoided = false } = {}) {
  const wanted = normalizeTopic(topic);
  if (!wanted) return [];
  const floor = qualityFloor(minQuality);

  const hits = [];
  for (const entry of entries) {
    const avoided = (entry.avoid || []).find((a) => a.topic === wanted);
    if (avoided && !includeAvoided) continue;

    const highlight = (entry.highlights || []).find((h) => h.topic === wanted);
    if (!highlight) continue;
    if (floor !== null && (highlight.quality === null || highlight.quality < floor)) continue;

    hits.push({
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      cloned: entry.cloned === true,
      localPath: entry.localPath || null,
      remoteUrl: entry.remoteUrl || '',
      status: entry.status,
      maturity: entry.maturity,
      stale: isStale(entry),
      topic: wanted,
      quality: highlight.quality,
      paths: highlight.paths,
      notes: highlight.notes,
      caveat: avoided ? avoided.reason : ''
    });
  }

  return hits.sort((a, b) => {
    const byQuality = (b.quality || 0) - (a.quality || 0);
    if (byQuality) return byQuality;
    return Number(a.stale) - Number(b.stale);
  });
}

function topicIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const highlight of entry.highlights || []) {
      const bucket = index.get(highlight.topic) || [];
      bucket.push({ id: entry.id, quality: highlight.quality });
      index.set(highlight.topic, bucket);
    }
  }
  return [...index.entries()]
    .map(([topic, repos]) => ({
      topic,
      count: repos.length,
      best: repos.reduce((max, r) => Math.max(max, r.quality || 0), 0),
      repos: repos.sort((a, b) => (b.quality || 0) - (a.quality || 0)).map((r) => r.id)
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function bucketKey(entry, groupBy) {
  if (groupBy === 'kind') return entry.kind || 'other';
  if (groupBy === 'status') return entry.status || 'active';
  const platform = (entry.platforms || [])[0];
  if (platform) return platform;
  return entry.kind || 'other';
}

function describeEntryInline(entry) {
  const highlights = (entry.highlights || [])
    .slice()
    .sort((a, b) => (b.quality || 0) - (a.quality || 0))
    .slice(0, 3)
    .map((h) => `${h.topic}:${h.quality ?? '?'}`)
    .join(', ');

  const flags = [];
  if (isStale(entry) || entry.status === 'archived') flags.push('⚠old');
  if (!entry.cloned) flags.push('remote');
  if (entry.isFork) flags.push('fork');

  const suffix = flags.length ? ` ${flags.join('/')}` : '';
  return highlights ? `${entry.id}(${highlights}${suffix})` : `${entry.id}(${flags.join('/') || '—'})`;
}

/**
 * The digest is the thing you paste into a prompt. It trades completeness for
 * token cost on purpose: enough for an agent to know where to look, no more.
 */
function buildDigest(entries, { groupBy = 'platform', maxPerBucket = 8, onlyWithHighlights = true } = {}) {
  const source = onlyWithHighlights ? entries.filter((e) => (e.highlights || []).length) : entries;
  const buckets = new Map();

  for (const entry of source) {
    const key = bucketKey(entry, groupBy);
    const bucket = buckets.get(key) || [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }

  const lines = [];
  const sortedBuckets = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const width = Math.min(16, Math.max(...sortedBuckets.map(([key]) => key.length), 8));

  for (const [key, bucketEntries] of sortedBuckets) {
    const ranked = bucketEntries
      .slice()
      .sort((a, b) => (bestQuality(b) || 0) - (bestQuality(a) || 0))
      .slice(0, maxPerBucket)
      .map(describeEntryInline);
    const omitted = bucketEntries.length - ranked.length;
    const tail = omitted > 0 ? ` +${omitted} more` : '';
    lines.push(`${key.padEnd(width)} ${ranked.join(' ')}${tail}`);
  }

  return lines.join('\n');
}

function describeEntry(entry) {
  const lines = [];
  lines.push(`# ${entry.name || entry.id}${entry.repo ? `  (${entry.repo})` : ''}`);
  if (entry.summary) lines.push(entry.summary);
  lines.push('');

  const facts = [
    ['kind', entry.kind],
    ['status', entry.status],
    ['maturity', entry.maturity],
    ['platforms', (entry.platforms || []).join(', ')],
    ['languages', (entry.languages || []).join(', ')],
    ['visibility', entry.visibility],
    ['groups', (entry.groups || []).join(', ')],
    ['last activity', entry.lastActivity ? entry.lastActivity.slice(0, 10) : ''],
    ['local path', entry.cloned ? entry.localPath : `not cloned${entry.remoteUrl ? ` — ${entry.remoteUrl}` : ''}`],
    ['sources', (entry.sources || []).join(' < ')]
  ].filter(([, value]) => value);

  for (const [label, value] of facts) lines.push(`${label.padEnd(14)} ${value}`);

  if ((entry.highlights || []).length) {
    lines.push('', 'Worth reading:');
    for (const highlight of entry.highlights) {
      const paths = highlight.paths?.length ? `  [${highlight.paths.join(', ')}]` : '';
      lines.push(`  ${String(highlight.quality ?? '?')}/5  ${highlight.topic}${paths}`);
      if (highlight.notes) lines.push(`        ${highlight.notes}`);
    }
  }

  if ((entry.avoid || []).length) {
    lines.push('', 'Do not copy:');
    for (const avoid of entry.avoid) lines.push(`  ${avoid.topic} — ${avoid.reason || 'no reason recorded'}`);
  }

  if ((entry.seeAlso || []).length) lines.push('', `See also: ${entry.seeAlso.join(', ')}`);

  return lines.join('\n');
}

module.exports = {
  STALE_AFTER_DAYS,
  isStale,
  bestQuality,
  filterEntries,
  findByTopic,
  topicIndex,
  buildDigest,
  describeEntry,
  describeEntryInline
};
