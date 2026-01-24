class TTLCache {
  constructor({ defaultTtlMs = 60_000, maxEntries = 200 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  _now() {
    return Date.now();
  }

  _prune() {
    const now = this._now();
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this._now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const expiresAt = this._now() + ttlMs;
    this.map.set(key, { value, expiresAt });
    this._prune();
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  async getOrCompute(key, computeFn, { ttlMs = this.defaultTtlMs, force = false } = {}) {
    if (!force) {
      const cached = this.get(key);
      if (cached !== null) return cached;
    }

    const value = await computeFn();
    this.set(key, value, ttlMs);
    return value;
  }
}

module.exports = { TTLCache };

