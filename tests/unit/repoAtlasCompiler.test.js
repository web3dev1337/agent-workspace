const { compileBundle, decide, redactForAudience } = require('../../server/atlas/atlasCompiler');
const { normalizeEntry } = require('../../server/atlas/atlasSchema');

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
});
