const fs = require('fs');
const os = require('os');
const path = require('path');

const RepoAtlasService = require('../../server/repoAtlasService');
const store = require('../../server/atlas/atlasStore');

describe('RepoAtlasService', () => {
  let tmpDir;
  let repoDir;
  let atlas;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
    repoDir = path.join(tmpDir, 'repos', 'acme-tycoon');
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.AGENT_WORKSPACE_ATLAS_DIR = path.join(tmpDir, 'atlas');

    atlas = new RepoAtlasService();
    store.saveDiscoveryCache([{
      __source: 'discovery',
      id: 'acme-tycoon',
      name: 'acme-tycoon',
      repo: 'owner/acme-tycoon',
      kind: 'game',
      languages: ['TypeScript'],
      localPath: repoDir,
      cloned: true,
      lastActivity: new Date().toISOString()
    }]);
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ATLAS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('discovery alone produces a usable entry', () => {
    const entry = atlas.getEntry('acme-tycoon');
    expect(entry.kind).toBe('game');
    expect(entry.visibility).toBe('private');
    expect(entry.sources).toEqual(['discovery']);
  });

  test('an in-repo manifest layers over discovery', () => {
    fs.writeFileSync(path.join(repoDir, '.repo-atlas.json'), JSON.stringify({
      id: 'acme-tycoon',
      summary: 'Multiplayer zoo tycoon',
      highlights: [{ topic: 'data-compression', quality: 5, notes: 'bitpacked saves' }]
    }));
    atlas.invalidate();

    const entry = atlas.getEntry('acme-tycoon');
    expect(entry.summary).toBe('Multiplayer zoo tycoon');
    expect(entry.kind).toBe('game');
    expect(entry.highlights[0].topic).toBe('data-compression');
    expect(entry.sources).toEqual(['discovery', 'manifest']);
  });

  test('the registry overrides the manifest — your opinion wins', () => {
    fs.writeFileSync(path.join(repoDir, '.repo-atlas.json'), JSON.stringify({
      id: 'acme-tycoon',
      summary: 'From the repo',
      maturity: 'production'
    }));
    atlas.setEntry('acme-tycoon', { summary: 'From you', maturity: 'prototype' });

    const entry = atlas.getEntry('acme-tycoon');
    expect(entry.summary).toBe('From you');
    expect(entry.maturity).toBe('prototype');
    expect(entry.sources).toEqual(['discovery', 'manifest', 'registry']);
  });

  test('addHighlight persists and replaces the same topic', () => {
    atlas.addHighlight('acme-tycoon', { topic: 'multiplayer', quality: 3, notes: 'chatty' });
    atlas.addHighlight('acme-tycoon', { topic: 'networking', quality: 5, paths: ['src/net'], notes: 'rewritten' });

    const entry = new RepoAtlasService().getEntry('acme-tycoon');
    expect(entry.highlights).toEqual([
      { topic: 'networking', quality: 5, paths: ['src/net'], notes: 'rewritten' }
    ]);
  });

  test('addAvoid records a do-not-copy note without removing the repo', () => {
    atlas.addAvoid('acme-tycoon', { topic: 'ui', reason: 'hand-rolled' });
    const entry = atlas.getEntry('acme-tycoon');
    expect(entry.avoid).toEqual([{ topic: 'ui', reason: 'hand-rolled' }]);
    expect(atlas.find('ui')).toEqual([]);
  });

  test('entries can be recorded for repos that were never cloned', () => {
    atlas.setEntry('never-cloned', {
      name: 'never-cloned',
      summary: 'lives only on GitHub',
      remoteUrl: 'https://github.com/owner/never-cloned'
    });
    atlas.addHighlight('never-cloned', { topic: 'auth', quality: 4 });

    const hits = atlas.find('auth');
    expect(hits).toHaveLength(1);
    expect(hits[0].cloned).toBe(false);
    expect(hits[0].remoteUrl).toBe('https://github.com/owner/never-cloned');
  });

  test('compile writes an audience bundle and withholds private entries', () => {
    atlas.setAudience({ id: 'core-team', label: 'Core team' });
    atlas.setEntry('acme-tycoon', { visibility: 'team', groups: ['core-team'] });
    atlas.setEntry('secret-thing', { name: 'secret', visibility: 'private' });

    const result = atlas.compile('core-team');
    expect(result.counts.included).toBe(1);
    expect(result.bundle.entries[0].id).toBe('acme-tycoon');

    const written = JSON.parse(fs.readFileSync(result.written[0], 'utf8'));
    expect(written.entries.map((e) => e.id)).toEqual(['acme-tycoon']);
    expect(JSON.stringify(written)).not.toContain(repoDir);
  });

  test('compile --dry-run writes nothing', () => {
    atlas.setEntry('acme-tycoon', { visibility: 'public' });
    const result = atlas.compile('core-team', { write: false });
    expect(result.written).toEqual([]);
    expect(fs.existsSync(store.bundlesDir())).toBe(false);
  });

  test('initManifest seeds a manifest from what is already known', () => {
    const { path: manifestPath, entry } = atlas.initManifest(repoDir);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(entry.id).toBe('acme-tycoon');
    expect(entry.kind).toBe('game');
    expect(entry.visibility).toBe('private');
  });

  test('refresh with both scanners disabled clears the map instead of hanging', async () => {
    const result = await atlas.refresh({ scanLocal: false, scanGitHub: false });
    expect(result.totalCount).toBe(0);
    expect(atlas.getEntries()).toEqual([]);
  });

  test('getStatus reports where data lives and how much is curated', () => {
    atlas.addHighlight('acme-tycoon', { topic: 'testing', quality: 4 });
    const status = atlas.getStatus();
    expect(status.entryCount).toBe(1);
    expect(status.clonedCount).toBe(1);
    expect(status.highlightCount).toBe(1);
    expect(status.registryDir).toContain('registry');
    expect(status.curatedCount).toBe(1);
  });

  describe('encrypted sharing', () => {
    beforeEach(() => {
      atlas.setAudience({ id: 'core-team', label: 'Core team' });
      atlas.setEntry('acme-tycoon', { visibility: 'encrypted', summary: 'gated by repo access' });
      atlas.addHighlight('acme-tycoon', { topic: 'testing', quality: 5, notes: 'do not leak this' });
    });

    test('generateRepoKey writes .repo-atlas-key into the cloned repo and caches it', () => {
      const result = atlas.generateRepoKey('acme-tycoon');
      expect(result.generated).toBe(true);
      expect(fs.existsSync(path.join(repoDir, '.repo-atlas-key'))).toBe(true);
      expect(store.loadCachedRepoKey('owner/acme-tycoon')).toBe(result.key);
    });

    test('generateRepoKey is idempotent unless --rotate is asked for', () => {
      const first = atlas.generateRepoKey('acme-tycoon');
      const second = atlas.generateRepoKey('acme-tycoon');
      expect(second.generated).toBe(false);
      expect(second.key).toBe(first.key);
    });

    test('generateRepoKey --rotate replaces the key', () => {
      const first = atlas.generateRepoKey('acme-tycoon');
      const rotated = atlas.generateRepoKey('acme-tycoon', { rotate: true });
      expect(rotated.key).not.toBe(first.key);
      expect(atlas.getRepoKey('acme-tycoon')).toBe(rotated.key);
    });

    test('generateRepoKey refuses a repo you have not cloned', () => {
      atlas.setEntry('never-cloned', { name: 'never-cloned', visibility: 'encrypted' });
      expect(() => atlas.generateRepoKey('never-cloned')).toThrow(/not cloned locally/);
    });

    test('compile auto-generates a key and ships ciphertext, not plaintext', () => {
      const result = atlas.compile('core-team');
      expect(result.counts.included).toBe(1);

      const sealed = result.bundle.entries[0];
      expect(sealed.id).toBe('acme-tycoon');
      expect(sealed.visibility).toBe('encrypted');
      expect(sealed.encrypted).toBeTruthy();
      expect(JSON.stringify(sealed)).not.toMatch(/do not leak this/);
      expect(JSON.stringify(sealed)).not.toMatch(/gated by repo access/);

      // The key it just used is now on disk, ready to commit.
      expect(fs.existsSync(path.join(repoDir, '.repo-atlas-key'))).toBe(true);
    });

    test('compiling twice reuses the same key instead of rotating on every publish', () => {
      const first = atlas.compile('core-team').bundle.entries[0].encrypted;
      const second = atlas.compile('core-team').bundle.entries[0].encrypted;
      // Different nonce/salt per encryption, but decryptable by the same key —
      // prove that by checking the key file on disk never changed.
      const key = store.readRepoKey(repoDir);
      expect(() => require('../../server/atlas/atlasEncryption').unsealEntry({ encrypted: first }, key)).not.toThrow();
      expect(() => require('../../server/atlas/atlasEncryption').unsealEntry({ encrypted: second }, key)).not.toThrow();
    });

    test('unlockEncrypted reports nothing to do when everything is already yours', async () => {
      const result = await atlas.unlockEncrypted();
      // Your own entries are never sealed locally — only compiled OUTPUT is —
      // so there is nothing locked to unlock in your own view.
      expect(result).toEqual({ checked: 0, unlocked: 0, stillLocked: [] });
    });
  });
});
