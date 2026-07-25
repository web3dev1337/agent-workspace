const { filterEntries, findByTopic, topicIndex, buildDigest } = require('../../server/atlas/atlasQuery');
const { normalizeEntry } = require('../../server/atlas/atlasSchema');

const DAY_MS = 86_400_000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

const entries = [
  normalizeEntry({
    id: 'box2d-luau',
    kind: 'library',
    platforms: ['roblox'],
    languages: ['Luau'],
    cloned: true,
    localPath: '/repos/box2d-luau',
    lastActivity: daysAgo(2),
    highlights: [
      { topic: 'physics', quality: 5, paths: ['src/'], notes: 'faithful port' },
      { topic: 'tests', quality: 5, notes: 'best harness we have' }
    ]
  }, { strict: true }),
  normalizeEntry({
    id: 'drain-the-lake',
    kind: 'game',
    platforms: ['roblox'],
    cloned: true,
    lastActivity: daysAgo(500),
    highlights: [{ topic: 'testing', quality: 3, notes: 'rough but useful' }],
    avoid: [{ topic: 'architecture', reason: 'prototype spaghetti' }]
  }, { strict: true }),
  normalizeEntry({
    id: 'epic-survivors',
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
    expect(ids).toEqual(['box2d-luau']);
  });

  test('filters compose across kind, platform and fork state', () => {
    expect(filterEntries(entries, { platform: 'roblox' }).map((e) => e.id))
      .toEqual(['box2d-luau', 'drain-the-lake']);
    expect(filterEntries(entries, { includeForks: false }).map((e) => e.id)).not.toContain('some-fork');
    expect(filterEntries(entries, { includeArchived: false }).map((e) => e.id)).not.toContain('epic-survivors');
  });

  test('text search reaches highlight notes, not just names', () => {
    expect(filterEntries(entries, { query: 'best harness' }).map((e) => e.id)).toEqual(['box2d-luau']);
  });

  test('findByTopic ranks by quality and resolves topic aliases', () => {
    const hits = findByTopic(entries, 'unit-tests');
    expect(hits.map((h) => h.id)).toEqual(['box2d-luau', 'drain-the-lake']);
    expect(hits[0].quality).toBe(5);
  });

  test('findByTopic marks long-untouched repos as stale', () => {
    const hits = findByTopic(entries, 'testing');
    expect(hits.find((h) => h.id === 'drain-the-lake').stale).toBe(true);
    expect(hits.find((h) => h.id === 'box2d-luau').stale).toBe(false);
  });

  test('findByTopic honours a quality floor', () => {
    expect(findByTopic(entries, 'testing', { minQuality: 4 }).map((h) => h.id)).toEqual(['box2d-luau']);
  });

  test('an avoid entry hides that repo for that topic only', () => {
    expect(findByTopic(entries, 'architecture')).toEqual([]);
    expect(findByTopic(entries, 'testing').map((h) => h.id)).toContain('drain-the-lake');
  });

  test('topicIndex summarizes who has what', () => {
    const index = topicIndex(entries);
    const testing = index.find((row) => row.topic === 'testing');
    expect(testing.count).toBe(2);
    expect(testing.repos[0]).toBe('box2d-luau');
  });

  test('digest groups by platform and flags stale repos', () => {
    const digest = buildDigest(entries, { groupBy: 'platform' });
    expect(digest).toMatch(/roblox/);
    expect(digest).toMatch(/box2d-luau\(physics:5, testing:5\)/);
    expect(digest).toMatch(/drain-the-lake\(testing:3 ⚠old\)/);
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
