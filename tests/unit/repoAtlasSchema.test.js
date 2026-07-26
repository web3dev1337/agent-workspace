const {
  normalizeEntry,
  mergeEntries,
  normalizeTopic,
  validateEntry,
  kebab
} = require('../../server/atlas/atlasSchema');

describe('atlasSchema', () => {
  test('normalizeTopic folds aliases onto the canonical vocabulary', () => {
    expect(normalizeTopic('multiplayer')).toBe('networking');
    expect(normalizeTopic('Net')).toBe('networking');
    expect(normalizeTopic('save-system')).toBe('data-persistence');
    expect(normalizeTopic('tests')).toBe('testing');
  });

  test('normalizeTopic keeps unknown topics rather than dropping them', () => {
    expect(normalizeTopic('Weather Simulation')).toBe('weather-simulation');
  });

  test('kebab strips punctuation and collapses separators', () => {
    expect(kebab('  My Cool_Repo / v2 ')).toBe('my-cool-repo-v2');
  });

  test('normalizeEntry keeps only supplied keys unless strict', () => {
    const partial = normalizeEntry({ id: 'zoo-game', quality: 9 });
    expect(partial).toEqual({ id: 'zoo-game', quality: 5 });

    const strict = normalizeEntry({ id: 'zoo-game' }, { strict: true });
    expect(strict.visibility).toBe('private');
    expect(strict.highlights).toEqual([]);
  });

  test('normalizeEntry clamps quality and normalizes highlight topics', () => {
    const entry = normalizeEntry({
      id: 'x',
      highlights: [{ topic: 'Netcode', quality: 0, paths: 'src/net, src/rpc' }]
    });
    expect(entry.highlights).toEqual([
      { topic: 'networking', quality: 1, paths: ['src/net', 'src/rpc'], notes: '' }
    ]);
  });

  test('an unscored highlight stays unscored rather than becoming quality 1', () => {
    const entry = normalizeEntry({
      id: 'x',
      highlights: [
        { topic: 'testing', quality: null, notes: 'no opinion yet' },
        { topic: 'physics' }
      ]
    });
    expect(entry.highlights.map((h) => h.quality)).toEqual([null, null]);
  });

  test('normalizeEntry only accepts redactions for known fields', () => {
    const entry = normalizeEntry({ id: 'x', redact: ['notes', 'secrets', 'paths'] });
    expect(entry.redact).toEqual(['notes', 'paths']);
  });

  test('mergeEntries lets later layers win per field without wiping earlier ones', () => {
    const merged = mergeEntries(
      { __source: 'discovery', id: 'zoo-game', name: 'zoo-game', kind: 'game', languages: ['TypeScript'] },
      { __source: 'manifest', summary: 'Multiplayer zoo tycoon', highlights: [{ topic: 'networking', quality: 3 }] },
      { __source: 'registry', visibility: 'team', groups: ['core-team'] }
    );

    expect(merged.kind).toBe('game');
    expect(merged.languages).toEqual(['TypeScript']);
    expect(merged.summary).toBe('Multiplayer zoo tycoon');
    expect(merged.visibility).toBe('team');
    expect(merged.groups).toEqual(['core-team']);
    expect(merged.sources).toEqual(['discovery', 'manifest', 'registry']);
  });

  test('mergeEntries does not let an empty later layer erase real data', () => {
    const merged = mergeEntries(
      { __source: 'discovery', id: 'x', summary: 'Real summary', languages: ['Luau'] },
      { __source: 'registry', summary: '', languages: [] }
    );
    expect(merged.summary).toBe('Real summary');
    expect(merged.languages).toEqual(['Luau']);
  });

  test('highlightsAdd appends to the inherited list instead of replacing it', () => {
    const merged = mergeEntries(
      { __source: 'manifest', id: 'x', highlights: [{ topic: 'testing', quality: 4 }] },
      { __source: 'registry', highlightsAdd: [{ topic: 'physics', quality: 5 }] }
    );
    expect(merged.highlights.map((h) => h.topic).sort()).toEqual(['physics', 'testing']);
  });

  test('a later highlight for the same topic overrides the earlier score', () => {
    const merged = mergeEntries(
      { __source: 'manifest', id: 'x', highlights: [{ topic: 'testing', quality: 4 }] },
      { __source: 'registry', highlightsAdd: [{ topic: 'tests', quality: 1, notes: 'actually rotted' }] }
    );
    expect(merged.highlights).toEqual([
      { topic: 'testing', quality: 1, paths: [], notes: 'actually rotted' }
    ]);
  });

  test('validateEntry flags team visibility with no groups as a dead-end share', () => {
    const entry = normalizeEntry({ id: 'x', visibility: 'team', summary: 's', highlights: [{ topic: 'ui', quality: 3 }] }, { strict: true });
    const report = validateEntry(entry);
    expect(report.ok).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/lands in no bundle/);
  });
});
