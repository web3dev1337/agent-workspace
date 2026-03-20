const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

class PersistentSWRCache {
  constructor({
    filePath,
    defaultTtlMs = 60_000,
    staleWhileRevalidateMs = 5 * 60_000,
    maxEntries = 500,
    persistDebounceMs = 750
  } = {}) {
    const { getAgentWorkspaceDir } = require('./pathUtils');
    this.filePath = filePath || path.join(getAgentWorkspaceDir(), 'cache', 'tasks-swr-cache.json');
    this.defaultTtlMs = defaultTtlMs;
    this.staleWhileRevalidateMs = staleWhileRevalidateMs;
    this.maxEntries = maxEntries;
    this.persistDebounceMs = persistDebounceMs;

    this.map = new Map(); // key -> { value, expiresAt }
    this.inflight = new Map(); // key -> Promise

    this._persistTimer = null;
    this._loadFromDiskSync();
  }

  _now() {
    return Date.now();
  }

  _loadFromDiskSync() {
    try {
      if (!fsSync.existsSync(this.filePath)) return;
      const raw = fsSync.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const e of entries) {
        const key = String(e?.key || '').trim();
        if (!key) continue;
        const expiresAt = Number(e?.expiresAt || 0);
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) continue;
        this.map.set(key, { value: e?.value, expiresAt });
      }
      this._prune();
    } catch {
      // ignore (cache should be best-effort)
    }
  }

  _prune() {
    const now = this._now();
    const staleCutoff = now - Math.max(0, Number(this.staleWhileRevalidateMs) || 0);

    for (const [key, entry] of this.map.entries()) {
      const expiresAt = Number(entry?.expiresAt || 0);
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
        this.map.delete(key);
        continue;
      }
      if (expiresAt <= staleCutoff) {
        this.map.delete(key);
      }
    }

    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }

  _schedulePersist() {
    if (this.persistDebounceMs <= 0) {
      this.flush().catch(() => {});
      return;
    }
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.flush().catch(() => {});
    }, this.persistDebounceMs);
  }

  get(key, { allowStale = false } = {}) {
    const k = String(key || '').trim();
    if (!k) return null;
    const entry = this.map.get(k);
    if (!entry) return null;
    const now = this._now();
    const expiresAt = Number(entry.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      this.map.delete(k);
      return null;
    }

    if (expiresAt > now) return entry.value;
    if (!allowStale) return null;

    const staleUntil = expiresAt + Math.max(0, Number(this.staleWhileRevalidateMs) || 0);
    if (staleUntil > now) return entry.value;

    this.map.delete(k);
    return null;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const k = String(key || '').trim();
    if (!k) return value;
    const ttl = Math.max(0, Number(ttlMs) || 0);
    const expiresAt = this._now() + ttl;
    this.map.set(k, { value, expiresAt });
    this._prune();
    this._schedulePersist();
    return value;
  }

  delete(key) {
    const k = String(key || '').trim();
    if (!k) return false;
    const removed = this.map.delete(k);
    if (removed) this._schedulePersist();
    return removed;
  }

  clear() {
    this.map.clear();
    this._schedulePersist();
  }

  async flush() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const entries = [];
      for (const [key, entry] of this.map.entries()) {
        entries.push({ key, value: entry.value, expiresAt: entry.expiresAt });
      }
      const payload = {
        v: 1,
        updatedAt: new Date().toISOString(),
        entries
      };
      await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  waitForRevalidate(key) {
    const k = String(key || '').trim();
    const p = this.inflight.get(k);
    return p ? p.catch(() => null) : Promise.resolve(null);
  }

  async getOrCompute(key, computeFn, { ttlMs = this.defaultTtlMs, force = false } = {}) {
    const k = String(key || '').trim();
    if (!k) throw new Error('key is required');
    if (typeof computeFn !== 'function') throw new Error('computeFn must be a function');

    const now = this._now();
    const entry = this.map.get(k);

    const computeAndSet = async () => {
      const value = await computeFn();
      this.set(k, value, ttlMs);
      return value;
    };

    if (force) {
      const inflight = this.inflight.get(k);
      if (inflight) return inflight;
      const p = computeAndSet().finally(() => this.inflight.delete(k));
      this.inflight.set(k, p);
      return p;
    }

    if (entry) {
      const expiresAt = Number(entry.expiresAt || 0);
      if (Number.isFinite(expiresAt) && expiresAt > now) return entry.value;

      const staleUntil = expiresAt + Math.max(0, Number(this.staleWhileRevalidateMs) || 0);
      if (Number.isFinite(expiresAt) && staleUntil > now) {
        if (!this.inflight.has(k)) {
          const p = computeAndSet().finally(() => this.inflight.delete(k));
          this.inflight.set(k, p);
        }
        return entry.value;
      }
    }

    // Cold miss or fully stale: block and compute.
    const inflight = this.inflight.get(k);
    if (inflight) return inflight;
    const p = computeAndSet().finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }
}

module.exports = { PersistentSWRCache };

