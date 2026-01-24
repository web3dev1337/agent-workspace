const { TTLCache } = require('../../server/utils/ttlCache');

describe('TTLCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('getOrCompute caches within TTL', async () => {
    const cache = new TTLCache({ defaultTtlMs: 1000 });
    const compute = jest.fn().mockResolvedValue({ ok: true });

    const a = await cache.getOrCompute('k', compute);
    const b = await cache.getOrCompute('k', compute);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('getOrCompute expires after TTL', async () => {
    const cache = new TTLCache({ defaultTtlMs: 1000 });
    const compute = jest.fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    const a = await cache.getOrCompute('k', compute);
    jest.advanceTimersByTime(1500);
    const b = await cache.getOrCompute('k', compute);

    expect(a).toEqual({ v: 1 });
    expect(b).toEqual({ v: 2 });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  test('getOrCompute supports force refresh', async () => {
    const cache = new TTLCache({ defaultTtlMs: 60_000 });
    const compute = jest.fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    await cache.getOrCompute('k', compute);
    const forced = await cache.getOrCompute('k', compute, { force: true });

    expect(forced).toEqual({ v: 2 });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

