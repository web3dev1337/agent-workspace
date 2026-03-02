const { SessionRecoveryService } = require('../../server/sessionRecoveryService');

describe('SessionRecoveryService.clearAgent', () => {
  it('clears agent markers but preserves session identity and cwd', () => {
    const svc = new SessionRecoveryService();
    svc.saveWorkspaceState = jest.fn(); // avoid timers/open handles

    const workspaceId = 'ws';
    const sessionId = 'repo-work1-claude';
    svc.states.set(workspaceId, new Map([
      [sessionId, {
        sessionId,
        worktreePath: '/tmp/repo/work1',
        lastCwd: '/tmp/repo/work1',
        lastAgent: 'claude',
        lastMode: 'continue',
        lastAgentCommand: 'claude --continue',
        lastAgentCwd: '/tmp/repo/work1',
        lastConversationId: 'abc123',
        lastConversationPath: '/tmp/.claude/projects/x/abc123.jsonl'
      }]
    ]));

    const updated = svc.clearAgent(workspaceId, sessionId);
    expect(updated).toBeTruthy();
    expect(updated.sessionId).toBe(sessionId);
    expect(updated.lastCwd).toBe('/tmp/repo/work1');
    expect(updated.lastAgent).toBeNull();
    expect(updated.lastMode).toBeNull();
    expect(updated.lastAgentCommand).toBeNull();
    expect(updated.lastAgentCwd).toBeNull();
    expect(updated.lastConversationId).toBeNull();
    expect(updated.lastConversationPath).toBeNull();
  });

  it('makes cleared agent sessions non-recoverable unless server command exists', async () => {
    const svc = new SessionRecoveryService();
    svc.saveWorkspaceState = jest.fn(); // avoid timers/open handles

    const workspaceId = 'ws';
    const sessionId = 'repo-work1-claude';
    svc.states.set(workspaceId, new Map([
      [sessionId, {
        sessionId,
        worktreePath: '/tmp/repo/work1',
        lastCwd: '/tmp/repo/work1',
        lastAgent: 'claude',
        lastConversationId: 'abc123',
        updatedAt: '2026-02-09T00:00:00.000Z'
      }]
    ]));
    svc.loadWorkspaceState = jest.fn(async (id) => ({
      workspaceId: id,
      sessions: Object.fromEntries(svc.states.get(id) || new Map())
    }));

    svc.clearAgent(workspaceId, sessionId);

    const info = await svc.getRecoveryInfo(workspaceId, { allowSessionIds: [sessionId], pruneMissing: false });
    expect(info.recoverableSessions).toBe(0);
    expect(info.sessions).toEqual([]);
  });
});
