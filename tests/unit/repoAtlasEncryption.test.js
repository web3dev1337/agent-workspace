const fs = require('fs');
const os = require('os');
const path = require('path');

const encryption = require('../../server/atlas/atlasEncryption');
const store = require('../../server/atlas/atlasStore');
const { normalizeEntry } = require('../../server/atlas/atlasSchema');

const entry = (overrides) => normalizeEntry({
  id: 'sample',
  name: 'Sample',
  repo: 'acme/sample',
  owner: 'acme',
  kind: 'game',
  summary: 'A repo worth reading',
  visibility: 'encrypted',
  highlights: [{ topic: 'testing', quality: 5, paths: ['tests/'], notes: 'good harness' }],
  ...overrides
}, { strict: true });

describe('atlasEncryption', () => {
  let tmpDir;
  let repoDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-crypto-'));
    repoDir = path.join(tmpDir, 'repos', 'sample');
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.AGENT_WORKSPACE_ATLAS_DIR = path.join(tmpDir, 'atlas');
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_ATLAS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('generateKey produces a 256-bit key, different every time', () => {
    const a = encryption.generateKey();
    const b = encryption.generateKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  test('sealEntry keeps identity fields clear and hides judgement behind ciphertext', () => {
    const key = encryption.generateKey();
    const sealed = encryption.sealEntry(entry(), key);

    expect(sealed.id).toBe('sample');
    expect(sealed.repo).toBe('acme/sample');
    expect(sealed.visibility).toBe('encrypted');
    expect(sealed.encrypted).toBeTruthy();
    expect(sealed.summary).toBeUndefined();
    expect(sealed.highlights).toBeUndefined();
    expect(JSON.stringify(sealed)).not.toMatch(/good harness/);
  });

  test('unsealEntry with the right key restores the judgement fields', () => {
    const key = encryption.generateKey();
    const sealed = encryption.sealEntry(entry(), key);
    const restored = encryption.unsealEntry(sealed, key);

    expect(restored.summary).toBe('A repo worth reading');
    expect(restored.highlights[0].notes).toBe('good harness');
    expect(restored.encrypted).toBeNull();
  });

  test('the wrong key cannot decrypt', () => {
    const sealed = encryption.sealEntry(entry(), encryption.generateKey());
    expect(() => encryption.unsealEntry(sealed, encryption.generateKey())).toThrow();
  });

  test('a tampered ciphertext fails the auth tag check rather than decrypting garbage', () => {
    const key = encryption.generateKey();
    const sealed = encryption.sealEntry(entry(), key);
    sealed.encrypted.ciphertext = Buffer.from('tampered').toString('base64');
    expect(() => encryption.unsealEntry(sealed, key)).toThrow();
  });

  test('resolveKeysForPublish generates and writes a key for a cloned encrypted repo', () => {
    const own = [entry({ localPath: repoDir, cloned: true })];
    const keys = encryption.resolveKeysForPublish(own, { logger: { warn() {}, info() {} } });

    expect(keys.get('acme/sample')).toBeTruthy();
    expect(fs.existsSync(path.join(repoDir, store.REPO_KEY_FILENAME))).toBe(true);
    expect(store.readRepoKey(repoDir)).toBe(keys.get('acme/sample'));
  });

  test('resolveKeysForPublish reuses an existing key instead of overwriting it', () => {
    const preset = encryption.generateKey();
    store.writeRepoKey(repoDir, preset);
    const own = [entry({ localPath: repoDir, cloned: true })];

    const keys = encryption.resolveKeysForPublish(own, { logger: { warn() {}, info() {} } });
    expect(keys.get('acme/sample')).toBe(preset);
  });

  test('resolveKeysForPublish skips repos that are not cloned locally — never invents an orphan key', () => {
    const own = [entry({ localPath: null, cloned: false })];
    const warnings = [];
    const keys = encryption.resolveKeysForPublish(own, { logger: { warn: (m) => warnings.push(m), info() {} } });

    expect(keys.size).toBe(0);
    expect(warnings[0]).toMatch(/not cloned locally/);
  });

  test('rotateKeyForPublish replaces the key on disk and in the cache', () => {
    const original = encryption.generateKey();
    store.writeRepoKey(repoDir, original);
    const target = entry({ localPath: repoDir, cloned: true });

    const rotated = encryption.rotateKeyForPublish(target);
    expect(rotated).not.toBe(original);
    expect(store.readRepoKey(repoDir)).toBe(rotated);
    expect(store.loadCachedRepoKey('acme/sample')).toBe(rotated);
  });

  test('rotateKeyForPublish refuses to rotate a key for a repo with no local clone', () => {
    expect(() => encryption.rotateKeyForPublish(entry({ localPath: null, cloned: false })))
      .toThrow(/not cloned locally/);
  });

  test('resolveKeyLocal checks the cache before touching disk', () => {
    store.saveCachedRepoKey('acme/sample', 'cached-value');
    expect(encryption.resolveKeyLocal(entry({ localPath: repoDir, cloned: true }))).toBe('cached-value');
  });

  test('resolveKeyLocal falls back to a local clone and caches what it finds', () => {
    const key = encryption.generateKey();
    store.writeRepoKey(repoDir, key);
    expect(encryption.resolveKeyLocal(entry({ localPath: repoDir, cloned: true }))).toBe(key);
    expect(store.loadCachedRepoKey('acme/sample')).toBe(key);
  });

  test('resolveKeyLocal returns null rather than reaching the network', () => {
    expect(encryption.resolveKeyLocal(entry({ localPath: null, cloned: false }))).toBeNull();
  });

  test('resolveKeyRemote tries the local sources first, gh fetch only as a last resort', async () => {
    const fetchKey = jest.fn();
    const key = encryption.generateKey();
    store.saveCachedRepoKey('acme/sample', key);

    const resolved = await encryption.resolveKeyRemote(entry(), { fetchKey });
    expect(resolved).toBe(key);
    expect(fetchKey).not.toHaveBeenCalled();
  });

  test('resolveKeyRemote calls the injected gh fetch and caches a successful result', async () => {
    const key = encryption.generateKey();
    const fetchKey = jest.fn().mockResolvedValue(key);

    const resolved = await encryption.resolveKeyRemote(entry({ localPath: null, cloned: false }), { fetchKey });
    expect(resolved).toBe(key);
    expect(fetchKey).toHaveBeenCalledWith('acme/sample');
    expect(store.loadCachedRepoKey('acme/sample')).toBe(key);
  });

  test('resolveKeyRemote returns null when gh has no access rather than throwing', async () => {
    const fetchKey = jest.fn().mockResolvedValue(null);
    const resolved = await encryption.resolveKeyRemote(entry({ localPath: null, cloned: false }), { fetchKey });
    expect(resolved).toBeNull();
  });

  test('decryptIfPossible unlocks when a key is already available', () => {
    const key = encryption.generateKey();
    const sealed = encryption.sealEntry(entry(), key);
    store.saveCachedRepoKey('acme/sample', key);

    const result = encryption.decryptIfPossible(sealed);
    expect(result.locked).toBe(false);
    expect(result.summary).toBe('A repo worth reading');
  });

  test('decryptIfPossible marks an entry locked instead of throwing when no key is available', () => {
    const sealed = encryption.sealEntry(entry(), encryption.generateKey());
    const result = encryption.decryptIfPossible(sealed);
    expect(result.locked).toBe(true);
    expect(result.encrypted).toBeTruthy();
  });

  test('decryptIfPossible is a no-op for entries with nothing sealed', () => {
    const plain = entry({ visibility: 'public' });
    expect(encryption.decryptIfPossible(plain)).toBe(plain);
  });
});
