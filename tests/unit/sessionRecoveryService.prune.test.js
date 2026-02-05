const { SessionRecoveryService } = require('../../server/sessionRecoveryService');

describe('SessionRecoveryService (prune)', () => {
  it('pruneOlderThan removes entries older than cutoff', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-05T00:00:00.000Z'));

    const svc = new SessionRecoveryService();
    svc.saveWorkspaceStateSync = jest.fn(); // avoid disk writes

    const workspaceId = 'ws';
    svc.states.set(workspaceId, new Map(Object.entries({
      a: { sessionId: 'a', updatedAt: '2026-01-20T00:00:00.000Z' }, // old
      b: { sessionId: 'b', updatedAt: '2026-02-04T00:00:00.000Z' }, // recent
      c: { sessionId: 'c' } // missing timestamps => prunable
    })));

    const pruned = svc.pruneOlderThan(workspaceId, { olderThanMs: 7 * 24 * 60 * 60 * 1000 });

    expect(pruned).toBe(2);
    const map = svc.states.get(workspaceId);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
    expect(map.has('c')).toBe(false);
    expect(svc.saveWorkspaceStateSync).toHaveBeenCalled();

    jest.useRealTimers();
  });
});

