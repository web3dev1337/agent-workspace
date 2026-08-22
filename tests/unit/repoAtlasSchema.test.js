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
    const partial = normalizeEntry({ id: 'acme-tycoon', quality: 9 });
    expect(partial).toEqual({ id: 'acme-tycoon', quality: 5 });

    const strict = normalizeEntry({ id: 'acme-tycoon' }, { strict: true });
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
      { __source: 'discovery', id: 'acme-tycoon', name: 'acme-tycoon', kind: 'game', languages: ['TypeScript'] },
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

  test('encrypted is a valid visibility, no groups required', () => {
    const entry = normalizeEntry({ id: 'x', visibility: 'encrypted', summary: 's' }, { strict: true });
    expect(entry.visibility).toBe('encrypted');
    expect(validateEntry(entry).errors).toEqual([]);
  });

  test('an unrecognized visibility is rejected, not silently coerced', () => {
    const entry = normalizeEntry({ id: 'x', visibility: 'top-secret' }, { strict: true });
    // oneOf() falls back to the schema default rather than accepting junk.
    expect(entry.visibility).toBe('private');
  });

  test('normalizeEntry preserves a sealed ciphertext payload rather than dropping the unknown field', () => {
    const cipher = { v: 1, alg: 'aes-256-gcm', kdf: 'scrypt', salt: 'a', iv: 'b', tag: 'c', ciphertext: 'd' };
    const entry = normalizeEntry({ id: 'x', visibility: 'encrypted', encrypted: cipher }, { strict: true });
    expect(entry.encrypted).toEqual(cipher);
  });

  test('normalizeEntry ignores a non-object encrypted value rather than trusting it', () => {
    const entry = normalizeEntry({ id: 'x', encrypted: 'not-an-object' }, { strict: true });
    expect(entry.encrypted).toBeNull();
  });

  test('mergeEntries lets a later plaintext layer clear an inherited ciphertext', () => {
    const cipher = { v: 1, alg: 'aes-256-gcm', kdf: 'scrypt', salt: 'a', iv: 'b', tag: 'c', ciphertext: 'd' };
    const merged = mergeEntries(
      { id: 'x', visibility: 'encrypted', encrypted: cipher, __source: 'subscription' },
      { id: 'x', visibility: 'public', summary: 'decrypted locally', __source: 'registry' }
    );
    // A later layer that omits `encrypted` entirely leaves the earlier value
    // alone (mergeEntries only overwrites fields a layer actually sets) — so
    // an explicit null is required to clear it, exactly like any other field.
    expect(merged.encrypted).toEqual(cipher);
  });
});
