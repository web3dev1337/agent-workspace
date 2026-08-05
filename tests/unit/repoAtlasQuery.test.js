const { filterEntries, findByTopic, topicIndex, buildDigest } = require('../../server/atlas/atlasQuery');
const { normalizeEntry } = require('../../server/atlas/atlasSchema');

const DAY_MS = 86_400_000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

const entries = [
  normalizeEntry({
    id: 'physics-kit',
    kind: 'library',
    platforms: ['roblox'],
    languages: ['Luau'],
    cloned: true,
    localPath: '/repos/physics-kit',
    lastActivity: daysAgo(2),
    highlights: [
      { topic: 'physics', quality: 5, paths: ['src/'], notes: 'faithful port' },
      { topic: 'tests', quality: 5, notes: 'best harness we have' }
    ]
  }, { strict: true }),
  normalizeEntry({
    id: 'puzzle-proto',
    kind: 'game',
    platforms: ['roblox'],
    cloned: true,
    lastActivity: daysAgo(500),
    highlights: [{ topic: 'testing', quality: 3, notes: 'rough but useful' }],
    avoid: [{ topic: 'architecture', reason: 'prototype spaghetti' }]
  }, { strict: true }),
  normalizeEntry({
    id: 'acme-shooter',
    kind: 'game',
    platforms: ['monogame'],
    languages: ['C#'],
    isFork: false,
    archived: true,
    status: 'archived',
    lastActivity: daysAgo(700),
    highlights: [{ topic: 'save-system', quality: 4 }]
  }, { strict: true }),
  normalizeEntry({
    id: 'some-fork',
    kind: 'reference',
    isFork: true,
    cloned: false
  }, { strict: true })
];

describe('atlasQuery', () => {
  test('an absent quality filter does not hide uncurated repos', () => {
    expect(filterEntries(entries, {}).length).toBe(4);
    expect(filterEntries(entries, { minQuality: null }).length).toBe(4);
    expect(filterEntries(entries, { minQuality: '' }).length).toBe(4);
  });

  test('minQuality filters on the best highlight a repo has', () => {
    const ids = filterEntries(entries, { minQuality: 5 }).map((e) => e.id);
    expect(ids).toEqual(['physics-kit']);
  });

  test('filters compose across kind, platform and fork state', () => {
    expect(filterEntries(entries, { platform: 'roblox' }).map((e) => e.id))
      .toEqual(['physics-kit', 'puzzle-proto']);
    expect(filterEntries(entries, { includeForks: false }).map((e) => e.id)).not.toContain('some-fork');
    expect(filterEntries(entries, { includeArchived: false }).map((e) => e.id)).not.toContain('acme-shooter');
  });

  test('text search reaches highlight notes, not just names', () => {
    expect(filterEntries(entries, { query: 'best harness' }).map((e) => e.id)).toEqual(['physics-kit']);
  });

  test('findByTopic ranks by quality and resolves topic aliases', () => {
    const hits = findByTopic(entries, 'unit-tests');
    expect(hits.map((h) => h.id)).toEqual(['physics-kit', 'puzzle-proto']);
    expect(hits[0].quality).toBe(5);
  });

  test('findByTopic marks long-untouched repos as stale', () => {
    const hits = findByTopic(entries, 'testing');
    expect(hits.find((h) => h.id === 'puzzle-proto').stale).toBe(true);
    expect(hits.find((h) => h.id === 'physics-kit').stale).toBe(false);
  });

  test('findByTopic honours a quality floor', () => {
    expect(findByTopic(entries, 'testing', { minQuality: 4 }).map((h) => h.id)).toEqual(['physics-kit']);
  });

  test('an avoid entry hides that repo for that topic only', () => {
    expect(findByTopic(entries, 'architecture')).toEqual([]);
    expect(findByTopic(entries, 'testing').map((h) => h.id)).toContain('puzzle-proto');
  });

  test('topicIndex summarizes who has what', () => {
    const index = topicIndex(entries);
    const testing = index.find((row) => row.topic === 'testing');
    expect(testing.count).toBe(2);
    expect(testing.repos[0]).toBe('physics-kit');
  });

  test('digest groups by platform and flags stale repos', () => {
    const digest = buildDigest(entries, { groupBy: 'platform' });
    expect(digest).toMatch(/roblox/);
    expect(digest).toMatch(/physics-kit\(physics:5, testing:5\)/);
    expect(digest).toMatch(/puzzle-proto\(testing:3 ⚠old\)/);
    expect(digest).not.toMatch(/some-fork/);
  });

  test('digest truncates long buckets rather than growing without limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => normalizeEntry({
      id: `repo-${i}`,
      platforms: ['roblox'],
      highlights: [{ topic: 'ui', quality: 3 }]
    }, { strict: true }));
    expect(buildDigest(many, { maxPerBucket: 4 })).toMatch(/\+8 more/);
  });
});
