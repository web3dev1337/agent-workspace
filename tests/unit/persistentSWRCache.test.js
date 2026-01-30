const fs = require('fs');
const os = require('os');
const path = require('path');

const { PersistentSWRCache } = require('../../server/utils/persistentSWRCache');

describe('PersistentSWRCache', () => {
  test('persists to disk and reloads', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-swr-cache-'));
    const filePath = path.join(dir, 'cache.json');

    const cache1 = new PersistentSWRCache({ filePath, persistDebounceMs: 0, staleWhileRevalidateMs: 60_000 });
    cache1.set('k1', { ok: true }, 60_000);
    await cache1.flush();

    const cache2 = new PersistentSWRCache({ filePath, persistDebounceMs: 0, staleWhileRevalidateMs: 60_000 });
    expect(cache2.get('k1')).toEqual({ ok: true });
  });

  test('returns stale while revalidating, then updates cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-swr-cache-'));
    const filePath = path.join(dir, 'cache.json');

    let now = 0;
    const cache = new PersistentSWRCache({ filePath, persistDebounceMs: 0, staleWhileRevalidateMs: 1000 });
    cache._now = () => now;

    cache.set('k', 'old', 10);

    now = 20; // expired, but still within SWR window
    const compute = jest.fn().mockResolvedValue('new');

    const v1 = await cache.getOrCompute('k', compute, { ttlMs: 10, force: false });
    expect(v1).toBe('old');
    expect(compute).toHaveBeenCalledTimes(1);

    await cache.waitForRevalidate('k');
    expect(cache.get('k')).toBe('new');

    const v2 = await cache.getOrCompute('k', compute, { ttlMs: 10, force: false });
    expect(v2).toBe('new');
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

