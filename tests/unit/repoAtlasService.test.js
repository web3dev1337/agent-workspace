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
    repoDir = path.join(tmpDir, 'repos', 'zoo-game');
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.AGENT_WORKSPACE_ATLAS_DIR = path.join(tmpDir, 'atlas');

    atlas = new RepoAtlasService();
    store.saveDiscoveryCache([{
      __source: 'discovery',
      id: 'zoo-game',
      name: 'zoo-game',
      repo: 'owner/zoo-game',
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
    const entry = atlas.getEntry('zoo-game');
    expect(entry.kind).toBe('game');
    expect(entry.visibility).toBe('private');
    expect(entry.sources).toEqual(['discovery']);
  });

  test('an in-repo manifest layers over discovery', () => {
    fs.writeFileSync(path.join(repoDir, '.repo-atlas.json'), JSON.stringify({
      id: 'zoo-game',
      summary: 'Multiplayer zoo tycoon',
      highlights: [{ topic: 'data-compression', quality: 5, notes: 'bitpacked saves' }]
    }));
    atlas.invalidate();

    const entry = atlas.getEntry('zoo-game');
    expect(entry.summary).toBe('Multiplayer zoo tycoon');
    expect(entry.kind).toBe('game');
    expect(entry.highlights[0].topic).toBe('data-compression');
    expect(entry.sources).toEqual(['discovery', 'manifest']);
  });

  test('the registry overrides the manifest — your opinion wins', () => {
    fs.writeFileSync(path.join(repoDir, '.repo-atlas.json'), JSON.stringify({
      id: 'zoo-game',
      summary: 'From the repo',
      maturity: 'production'
    }));
    atlas.setEntry('zoo-game', { summary: 'From you', maturity: 'prototype' });

    const entry = atlas.getEntry('zoo-game');
    expect(entry.summary).toBe('From you');
    expect(entry.maturity).toBe('prototype');
    expect(entry.sources).toEqual(['discovery', 'manifest', 'registry']);
  });

  test('addHighlight persists and replaces the same topic', () => {
    atlas.addHighlight('zoo-game', { topic: 'multiplayer', quality: 3, notes: 'chatty' });
    atlas.addHighlight('zoo-game', { topic: 'networking', quality: 5, paths: ['src/net'], notes: 'rewritten' });

    const entry = new RepoAtlasService().getEntry('zoo-game');
    expect(entry.highlights).toEqual([
      { topic: 'networking', quality: 5, paths: ['src/net'], notes: 'rewritten' }
    ]);
  });

  test('addAvoid records a do-not-copy note without removing the repo', () => {
    atlas.addAvoid('zoo-game', { topic: 'ui', reason: 'hand-rolled' });
    const entry = atlas.getEntry('zoo-game');
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
    atlas.setEntry('zoo-game', { visibility: 'team', groups: ['core-team'] });
    atlas.setEntry('secret-thing', { name: 'secret', visibility: 'private' });

    const result = atlas.compile('core-team');
    expect(result.counts.included).toBe(1);
    expect(result.bundle.entries[0].id).toBe('zoo-game');

    const written = JSON.parse(fs.readFileSync(result.written[0], 'utf8'));
    expect(written.entries.map((e) => e.id)).toEqual(['zoo-game']);
    expect(JSON.stringify(written)).not.toContain(repoDir);
  });

  test('compile --dry-run writes nothing', () => {
    atlas.setEntry('zoo-game', { visibility: 'public' });
    const result = atlas.compile('core-team', { write: false });
    expect(result.written).toEqual([]);
    expect(fs.existsSync(store.bundlesDir())).toBe(false);
  });

  test('initManifest seeds a manifest from what is already known', () => {
    const { path: manifestPath, entry } = atlas.initManifest(repoDir);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(entry.id).toBe('zoo-game');
    expect(entry.kind).toBe('game');
    expect(entry.visibility).toBe('private');
  });

  test('refresh with both scanners disabled clears the map instead of hanging', async () => {
    const result = await atlas.refresh({ scanLocal: false, scanGitHub: false });
    expect(result.totalCount).toBe(0);
    expect(atlas.getEntries()).toEqual([]);
  });

  test('getStatus reports where data lives and how much is curated', () => {
    atlas.addHighlight('zoo-game', { topic: 'testing', quality: 4 });
    const status = atlas.getStatus();
    expect(status.entryCount).toBe(1);
    expect(status.clonedCount).toBe(1);
    expect(status.highlightCount).toBe(1);
    expect(status.registryPath).toContain('registry.json');
  });
});
