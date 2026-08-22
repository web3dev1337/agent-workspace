const { compileBundle, decide, redactForAudience } = require('../../server/atlas/atlasCompiler');
const { normalizeEntry } = require('../../server/atlas/atlasSchema');
const { sealEntry, unsealEntry, generateKey } = require('../../server/atlas/atlasEncryption');

const entry = (overrides) => normalizeEntry({
  id: 'sample',
  name: 'Sample',
  summary: 'A repo',
  visibility: 'private',
  highlights: [{ topic: 'testing', quality: 5, paths: ['tests/'], notes: 'good harness' }],
  localPath: '/home/someone/GitHub/sample',
  cloned: true,
  ...overrides
}, { strict: true });

describe('atlasCompiler', () => {
  test('private entries never reach a bundle, even with a matching group', () => {
    const verdict = decide(entry({ visibility: 'private', groups: ['core-team'] }), 'core-team');
    expect(verdict.include).toBe(false);
    expect(verdict.reason).toMatch(/never shared/);
  });

  test('public entries reach every audience', () => {
    expect(decide(entry({ visibility: 'public' }), 'contractors').include).toBe(true);
    expect(decide(entry({ visibility: 'public' }), 'public').include).toBe(true);
  });

  test('team entries reach only the audiences listed in their groups', () => {
    const teamEntry = entry({ visibility: 'team', groups: ['core-team'] });
    expect(decide(teamEntry, 'core-team').include).toBe(true);
    expect(decide(teamEntry, 'contractors').include).toBe(false);
  });

  test('the public bundle refuses team entries outright', () => {
    const teamEntry = entry({ visibility: 'team', groups: ['public'] });
    expect(decide(teamEntry, 'public').include).toBe(false);
  });

  test('local-only fields are always stripped from shared entries', () => {
    const { entry: shared } = redactForAudience(entry({ visibility: 'public' }), 'core-team');
    expect(shared.localPath).toBeUndefined();
    expect(shared.cloned).toBeUndefined();
    expect(shared.groupOverrides).toBeUndefined();
    expect(shared.redact).toBeUndefined();
  });

  test('redact strips notes and paths but keeps the repo listed', () => {
    const { entry: shared, redactions } = redactForAudience(
      entry({ visibility: 'public', redact: ['notes', 'paths'] }),
      'core-team'
    );
    expect(redactions).toEqual(['notes', 'paths']);
    expect(shared.id).toBe('sample');
    expect(shared.highlights[0].quality).toBe(5);
    expect(shared.highlights[0].notes).toBe('');
    expect(shared.highlights[0].paths).toEqual([]);
  });

  test('groupOverrides redact for one audience without affecting another', () => {
    const source = entry({
      visibility: 'team',
      groups: ['core-team', 'contractors'],
      groupOverrides: { contractors: { redact: ['notes', 'paths'] } }
    });

    const core = redactForAudience(source, 'core-team').entry;
    const contractors = redactForAudience(source, 'contractors').entry;

    expect(core.highlights[0].notes).toBe('good harness');
    expect(contractors.highlights[0].notes).toBe('');
  });

  test('compileBundle reports what it shared, withheld and redacted', () => {
    const result = compileBundle([
      entry({ id: 'open', visibility: 'public' }),
      entry({ id: 'shared', visibility: 'team', groups: ['core-team'], redact: ['paths'] }),
      entry({ id: 'secret', visibility: 'private' }),
      entry({ id: 'other-team', visibility: 'team', groups: ['contractors'] })
    ], { audience: 'core-team' });

    expect(result.counts).toEqual({ total: 4, included: 2, excluded: 2, redacted: 1 });
    expect(result.bundle.entries.map((e) => e.id)).toEqual(['open', 'shared']);
    expect(result.bundle.audience).toBe('core-team');
    expect(JSON.stringify(result.bundle)).not.toContain('/home/someone');
  });

  test('compileBundle refuses to run without an audience', () => {
    expect(() => compileBundle([], {})).toThrow(/audience/);
  });

  describe('encrypted visibility', () => {
    test('reaches every audience, unlike team visibility', () => {
      const sealed = entry({ visibility: 'encrypted', repo: 'acme/sample', groups: [] });
      expect(decide(sealed, 'core-team').include).toBe(true);
      expect(decide(sealed, 'contractors').include).toBe(true);
      expect(decide(sealed, 'public').include).toBe(true);
    });

    test('compileBundle seals judgement fields when a repo key is provided', () => {
      const key = generateKey();
      const result = compileBundle(
        [entry({ id: 'secret-repo', visibility: 'encrypted', repo: 'acme/secret-repo' })],
        { audience: 'core-team', repoKeys: new Map([['acme/secret-repo', key]]) }
      );

      expect(result.counts).toEqual({ total: 1, included: 1, excluded: 0, redacted: 1 });
      const [sealed] = result.bundle.entries;
      expect(sealed.id).toBe('secret-repo');
      expect(sealed.repo).toBe('acme/secret-repo');
      expect(sealed.encrypted).toBeTruthy();
      expect(sealed.summary).toBeUndefined();
      expect(JSON.stringify(sealed)).not.toMatch(/good harness/);

      const restored = unsealEntry(sealed, key);
      expect(restored.summary).toBe('A repo');
      expect(restored.highlights[0].notes).toBe('good harness');
    });

    test('compileBundle excludes an encrypted entry rather than shipping it plaintext when no key is available', () => {
      const result = compileBundle(
        [entry({ id: 'secret-repo', visibility: 'encrypted', repo: 'acme/secret-repo' })],
        { audience: 'core-team' }
      );

      expect(result.bundle.entries).toEqual([]);
      expect(result.counts).toEqual({ total: 1, included: 0, excluded: 1, redacted: 0 });
      expect(result.decisions[0].reason).toMatch(/no repo key available/);
    });

    test('an already-sealed entry passed straight through stays sealed rather than resealed', () => {
      // Guards against a regression where compileBundle could double-encrypt
      // (or accidentally leak) an entry that is already ciphertext, e.g. one
      // relayed from a subscription without ever being decrypted locally.
      const key = generateKey();
      const sealed = sealEntry(entry({ id: 'relayed', visibility: 'encrypted', repo: 'acme/relayed' }), key);
      const relayable = normalizeEntry({ ...sealed, groups: [] }, { strict: true });

      const result = compileBundle([relayable], { audience: 'core-team', repoKeys: new Map([['acme/relayed', key]]) });
      expect(unsealEntry(result.bundle.entries[0], key).summary).toBe('A repo');
    });
  });
});
