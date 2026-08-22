const crypto = require('crypto');
const { execFile } = require('child_process');

const { encryptObject, decryptObject } = require('../encryptedStore');
const { ENCRYPTED_FIELDS } = require('./atlasSchema');
const store = require('./atlasStore');

const GH_TIMEOUT_MS = 15_000;

/**
 * Repo-key-gated encryption for atlas entries.
 *
 * The threat model is narrow on purpose: this hides curated notes about a
 * repo from anyone who does NOT have GitHub access to that repo. It is not
 * protection against someone who already has access — they could just read
 * the source. The key lives inside the repo it protects (`.repo-atlas-key`,
 * committed), so "can this person read the repo" and "can this person
 * decrypt the atlas entry about it" are the same question by construction.
 *
 * Revocation is not retroactive: removing someone's repo access does not
 * un-decrypt bundles they already pulled, same as it does not un-read code
 * they already cloned. `atlas key generate --rotate` stops NEW leaks going
 * forward; it cannot claw back what a former collaborator already has.
 */

function generateKey() {
  return crypto.randomBytes(32).toString('base64');
}

function pickEncryptedFields(entry) {
  const payload = {};
  for (const field of ENCRYPTED_FIELDS) {
    if (entry[field] !== undefined) payload[field] = entry[field];
  }
  return payload;
}

/**
 * Turn a redacted-but-plaintext entry into the stub that actually leaves the
 * machine: identity fields in the clear, judgement sealed behind the key.
 */
function sealEntry(entry, keyBase64) {
  if (!keyBase64) throw new Error('sealEntry requires a repo key');
  const payload = pickEncryptedFields(entry);
  const encrypted = encryptObject({ value: payload, passphrase: keyBase64 });

  return {
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    owner: entry.owner,
    kind: entry.kind,
    visibility: 'encrypted',
    encrypted
  };
}

/**
 * Reverse of sealEntry — merges the decrypted judgement fields back onto the
 * stub and clears the ciphertext. Throws on a wrong/missing key or a
 * tampered payload (AES-GCM auth tag failure), same as the underlying
 * encryptedStore helper.
 */
function unsealEntry(stub, keyBase64) {
  const payload = decryptObject({ payload: stub.encrypted, passphrase: keyBase64 });
  const merged = { ...stub, ...payload };
  merged.encrypted = null;
  return merged;
}

/**
 * Best-effort, no-network key resolution: local cache, then a local clone if
 * this machine happens to have one. Safe to call on a hot path (getEntries).
 */
function resolveKeyLocal(entry) {
  const repoId = entry.repo || entry.id;
  if (!repoId) return null;
  const cached = store.loadCachedRepoKey(repoId);
  if (cached) return cached;
  if (entry.localPath) {
    const fromClone = store.readRepoKey(entry.localPath);
    if (fromClone) {
      store.saveCachedRepoKey(repoId, fromClone);
      return fromClone;
    }
  }
  return null;
}

/**
 * For every owned entry marked `visibility: encrypted` and actually cloned
 * locally, read (or, on first publish, generate + write) its repo key. Never
 * touches a repo that is not cloned — you cannot commit a key file to a repo
 * you do not have a local checkout of, and generating one nobody commits
 * would be a key with nowhere for teammates to find it.
 */
function resolveKeysForPublish(ownEntries, { logger = console } = {}) {
  const keys = new Map();

  for (const entry of ownEntries) {
    if (entry.visibility !== 'encrypted') continue;
    const repoId = entry.repo || entry.id;
    if (!entry.cloned || !entry.localPath) {
      logger.warn?.(`atlas: "${entry.id}" is visibility:encrypted but not cloned locally — skipping (no repo to hold the key)`);
      continue;
    }

    let key = store.readRepoKey(entry.localPath);
    let generated = false;
    if (!key) {
      key = generateKey();
      store.writeRepoKey(entry.localPath, key);
      generated = true;
    }
    store.saveCachedRepoKey(repoId, key);
    keys.set(repoId, key);
    keys.set(entry.id, key);
    if (generated) {
      logger.info?.(`atlas: generated a new repo key for "${entry.id}" — commit .repo-atlas-key in that repo so teammates with access can decrypt it`);
    }
  }

  return keys;
}

function rotateKeyForPublish(entry) {
  if (!entry?.cloned || !entry.localPath) {
    throw new Error(`"${entry?.id}" is not cloned locally — cannot rotate a key you cannot commit`);
  }
  const key = generateKey();
  store.writeRepoKey(entry.localPath, key);
  const repoId = entry.repo || entry.id;
  store.saveCachedRepoKey(repoId, key);
  store.saveCachedRepoKey(entry.id, key);
  return key;
}

function execFileAsync(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '').trim(), error: error ? error.message : null });
    });
  });
}

/**
 * Fetch a repo key over the network via the `gh` CLI — this is the "someone
 * gave me repo access, now I want the key" path. `gh` naturally 403s/404s if
 * the caller's token cannot read that repo, so "no access" and "no such
 * file" both just resolve to null rather than throwing.
 */
async function defaultGhFetch(repoId, { timeout = GH_TIMEOUT_MS } = {}) {
  const result = await execFileAsync(
    'gh',
    ['api', `repos/${repoId}/contents/${store.REPO_KEY_FILENAME}`, '--jq', '.content'],
    { timeout, windowsHide: true }
  );
  if (!result.ok || !result.stdout.trim()) return null;
  try {
    const decoded = Buffer.from(result.stdout.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Try every source in order for entries you do NOT own a clone of: cache,
 * then `gh api` (network). Used by `atlas key sync` / after `atlas
 * subscribe`, never on the hot `getEntries()` path.
 */
async function resolveKeyRemote(entry, { fetchKey = defaultGhFetch } = {}) {
  const local = resolveKeyLocal(entry);
  if (local) return local;

  const repoId = entry.repo || entry.id;
  if (!repoId || !repoId.includes('/')) return null; // fetch needs owner/name

  const fetched = await fetchKey(repoId);
  if (fetched) store.saveCachedRepoKey(repoId, fetched);
  return fetched || null;
}

/**
 * Decrypt a merged entry in place if a key is already available without
 * touching the network. Entries with no `encrypted` payload (i.e. not
 * sealed, or already decrypted) pass through untouched.
 */
function decryptIfPossible(entry) {
  if (!entry?.encrypted) return entry;
  const key = resolveKeyLocal(entry);
  if (!key) return { ...entry, locked: true };
  try {
    return { ...unsealEntry(entry, key), locked: false };
  } catch {
    // Cached key no longer matches (rotated on the sharer's end) — treat as
    // locked rather than crash the whole atlas read.
    return { ...entry, locked: true };
  }
}

module.exports = {
  generateKey,
  sealEntry,
  unsealEntry,
  resolveKeyLocal,
  resolveKeysForPublish,
  rotateKeyForPublish,
  resolveKeyRemote,
  decryptIfPossible,
  defaultGhFetch
};
