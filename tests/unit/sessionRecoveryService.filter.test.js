const { SessionRecoveryService } = require('../../server/sessionRecoveryService');

describe('SessionRecoveryService (filtering)', () => {
  it('filters recovery info to only sessions still present in workspace', async () => {
    const svc = new SessionRecoveryService();
    svc.saveWorkspaceState = jest.fn(); // avoid timers/open handles

    const workspaceId = 'ws';
    const sessions = {
      'a-claude': { sessionId: 'a-claude', worktreePath: '/a', lastAgent: 'codex', updatedAt: '2026-01-31T00:00:00.000Z' },
      'b-claude': { sessionId: 'b-claude', worktreePath: '/b', lastAgent: 'codex', updatedAt: '2026-01-31T00:00:00.000Z' },
      'c-ignored': { sessionId: 'c-ignored', updatedAt: '2026-01-31T00:00:00.000Z' } // no worktreePath/command => ignored anyway
    };

    svc.loadWorkspaceState = jest.fn().mockImplementation(async (id) => {
      svc.states.set(id, new Map(Object.entries(sessions)));
      return { workspaceId: id, savedAt: '2026-01-31T00:00:00.000Z', sessions };
    });

    const out = await svc.getRecoveryInfo(workspaceId, { allowSessionIds: ['a-claude'], pruneMissing: true });

    expect(out.workspaceId).toBe(workspaceId);
    expect(out.recoverableSessions).toBe(1);
    expect(out.sessions.map(s => s.sessionId)).toEqual(['a-claude']);

    // Pruned from the in-memory store
    const map = svc.states.get(workspaceId);
    expect(map.has('a-claude')).toBe(true);
    expect(map.has('b-claude')).toBe(false);
  });
});

