const { resolveBuildProductionContext } = require('../../server/buildProductionService');

describe('buildProductionService', () => {
  test('derives scriptPath from session cwd', () => {
    const sessionManager = {
      sessions: new Map([
        ['work1-claude', { config: { cwd: '/tmp/my-worktree/work1' } }]
      ])
    };

    const ctx = resolveBuildProductionContext({ sessionManager, sessionId: 'work1-claude', worktreeNum: 1 });
    expect(ctx.worktreePath).toBe('/tmp/my-worktree/work1');
    expect(ctx.scriptPath).toBe('/tmp/my-worktree/work1/build-production-with-console.sh');
  });

  test('throws if sessionId not found or cwd missing', () => {
    const sessionManager = { sessions: new Map() };
    expect(() => resolveBuildProductionContext({ sessionManager, sessionId: 'missing', worktreeNum: 2 }))
      .toThrow(/No cwd found/);
  });
});
