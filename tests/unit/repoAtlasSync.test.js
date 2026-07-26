const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RepoAtlasService = require('../../server/repoAtlasService');
const store = require('../../server/atlas/atlasStore');

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });

describe('Repo Atlas multi-machine sync', () => {
  let root;
  let remote;

  const machine = (name) => {
    process.env.AGENT_WORKSPACE_ATLAS_DIR = path.join(root, name);
    const atlas = new RepoAtlasService();
    atlas.invalidate();
    return atlas;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-'));
    remote = path.join(root, 'remote.git');
    git(['init', '-q', '--bare', remote], root);
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ATLAS_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('curated entries are one file per repo so machines cannot conflict', () => {
    const atlas = machine('a');
    atlas.addHighlight('box2d-luau', { topic: 'testing', quality: 5 });
    atlas.addHighlight('zoo-game', { topic: 'networking', quality: 3 });

    expect(fs.readdirSync(store.entriesDir()).sort()).toEqual(['box2d-luau.json', 'zoo-game.json']);
  });

  test('judgement travels between machines; local discovery does not', async () => {
    const a = machine('a');
    await a.setRemote(remote);
    a.addHighlight('box2d-luau', { topic: 'testing', quality: 5, notes: 'best harness we have' });
    store.saveDiscoveryCache([{ id: 'only-on-a', name: 'only-on-a', localPath: '/machine/a/only-on-a', cloned: true }]);
    expect((await a.sync()).ok).toBe(true);

    const b = machine('b');
    await b.setRemote(remote);
    expect((await b.sync()).ok).toBe(true);

    // B inherited the judgement…
    const hits = b.find('testing');
    expect(hits).toHaveLength(1);
    expect(hits[0].notes).toBe('best harness we have');

    // …but not A's idea of what is on disk.
    expect(b.getEntry('only-on-a')).toBeNull();
  });

  test('two machines editing different repos merge without conflict', async () => {
    const a = machine('a');
    await a.setRemote(remote);
    a.addHighlight('repo-one', { topic: 'testing', quality: 5 });
    await a.sync();

    const b = machine('b');
    await b.setRemote(remote);
    await b.sync();
    b.addHighlight('repo-two', { topic: 'physics', quality: 4 });
    expect((await b.sync()).ok).toBe(true);

    const backOnA = machine('a');
    expect((await backOnA.sync()).ok).toBe(true);
    expect(backOnA.topics().map((t) => t.topic).sort()).toEqual(['physics', 'testing']);
  });

  test('sync refuses to run without a remote rather than failing silently', async () => {
    const result = await machine('a').sync();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No registry remote configured/);
  });

  test('a legacy single-file registry migrates into per-entry files', () => {
    process.env.AGENT_WORKSPACE_ATLAS_DIR = path.join(root, 'legacy');
    store.writeJson(store.legacyRegistryPath(), {
      schemaVersion: 1,
      audiences: [{ id: 'core-team', label: 'Core team' }],
      entries: {
        'old-repo': { id: 'old-repo', summary: 'from before the split', highlights: [{ topic: 'testing', quality: 4 }] }
      }
    });

    const atlas = new RepoAtlasService();
    const entry = atlas.getEntry('old-repo');

    expect(entry.summary).toBe('from before the split');
    expect(fs.existsSync(store.entryPath('old-repo'))).toBe(true);
    expect(atlas.listAudiences().map((a) => a.id)).toEqual(['core-team']);
  });

  describe('subscriptions', () => {
    const publishBundle = (dir, entries) => {
      const file = path.join(dir, 'atlas.core-team.json');
      store.writeJson(file, { schemaVersion: 1, audience: 'core-team', entryCount: entries.length, entries });
      return file;
    };

    test('a teammate can search what was shared with them', async () => {
      const shared = publishBundle(root, [{
        id: 'their-repo',
        name: 'their-repo',
        summary: 'shared with me',
        visibility: 'team',
        highlights: [{ topic: 'auth', quality: 4, notes: 'clean oauth flow' }]
      }]);

      const me = machine('me');
      await me.subscribe({ name: 'them', source: shared });

      const hits = me.find('auth');
      expect(hits).toHaveLength(1);
      expect(hits[0].cloned).toBe(false);
      expect(me.getEntry('their-repo').sharedBy).toBe('them');
    });

    test('what someone shared with you is never re-shared by you', async () => {
      const shared = publishBundle(root, [{
        id: 'their-repo',
        name: 'their-repo',
        visibility: 'public',
        highlights: [{ topic: 'auth', quality: 4 }]
      }]);

      const me = machine('me');
      await me.subscribe({ name: 'them', source: shared });
      me.addHighlight('my-repo', { topic: 'testing', quality: 5 });
      me.setEntry('my-repo', { visibility: 'public' });

      const compiled = me.compile('anyone', { write: false });
      expect(compiled.bundle.entries.map((e) => e.id)).toEqual(['my-repo']);
    });

    test('your own notes outrank anything a subscription says about the same repo', async () => {
      const shared = publishBundle(root, [{
        id: 'shared-repo',
        name: 'shared-repo',
        summary: 'their description',
        visibility: 'public',
        highlights: [{ topic: 'testing', quality: 2 }]
      }]);

      const me = machine('me');
      await me.subscribe({ name: 'them', source: shared });
      me.addHighlight('shared-repo', { topic: 'testing', quality: 5, notes: 'actually excellent' });

      const entry = me.getEntry('shared-repo');
      expect(entry.highlights[0].quality).toBe(5);
      expect(entry.summary).toBe('their description');
    });

    test('annotating a shared repo does not make it re-shareable', async () => {
      const shared = publishBundle(root, [{
        id: 'shared-repo',
        name: 'shared-repo',
        summary: 'their description',
        visibility: 'public',
        highlights: [{ topic: 'testing', quality: 2 }]
      }]);

      const me = machine('me');
      await me.subscribe({ name: 'them', source: shared });
      // A local note must not declassify a repo you only know about because a
      // teammate shared it — re-publishing it would leak their inherited fields.
      me.addHighlight('shared-repo', { topic: 'testing', quality: 5, notes: 'actually excellent' });
      me.setEntry('shared-repo', { visibility: 'public' });

      expect(me.getEntry('shared-repo').foreign).toBe(true);
      const compiled = me.compile('anyone', { write: false });
      expect(compiled.bundle.entries.map((e) => e.id)).not.toContain('shared-repo');
    });

    test('subscribing to something that is not a bundle fails loudly', async () => {
      const notABundle = path.join(root, 'nope.json');
      store.writeJson(notABundle, { hello: 'world' });
      await expect(machine('me').subscribe({ name: 'x', source: notABundle })).rejects.toThrow(/not an atlas bundle/);
    });

    test('unsubscribing removes those repos from search', async () => {
      const shared = publishBundle(root, [{ id: 'their-repo', name: 'their-repo', highlights: [{ topic: 'auth', quality: 4 }] }]);
      const me = machine('me');
      await me.subscribe({ name: 'them', source: shared });
      expect(me.find('auth')).toHaveLength(1);

      expect(me.unsubscribe('them')).toBe(true);
      expect(me.find('auth')).toEqual([]);
    });
  });
});
