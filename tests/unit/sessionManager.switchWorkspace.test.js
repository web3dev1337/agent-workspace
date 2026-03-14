const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager switchWorkspacePreservingSessions', () => {
  test('reuses the active workspace session map when switching to the same workspace', async () => {
    const io = { emit: jest.fn() };
    const sessionManager = new SessionManager(io, null);
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace 1',
      repository: { path: '/tmp/repo' },
      worktrees: { enabled: false, namingPattern: 'work{n}' },
      terminals: { pairs: 1 }
    };

    sessionManager.workspace = workspace;
    sessionManager.sessions = new Map([
      ['work1-claude', { id: 'work1-claude', workspace: 'workspace-1' }]
    ]);

    const initializeSpy = jest.spyOn(sessionManager, 'initializeSessions').mockResolvedValue();
    const getStatesSpy = jest.spyOn(sessionManager, 'getSessionStates').mockReturnValue({ 'work1-claude': { id: 'work1-claude' } });
    const backlogSpy = jest.spyOn(sessionManager, 'getUndeliveredOutputAndMarkDelivered').mockReturnValue({});

    const result = await sessionManager.switchWorkspacePreservingSessions({
      ...workspace,
      name: 'Workspace 1 renamed'
    });

    expect(initializeSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessions: { 'work1-claude': { id: 'work1-claude' } },
      backlog: {}
    });
    expect(sessionManager.workspace.name).toBe('Workspace 1 renamed');
    expect(sessionManager.workspaceSessionMaps.get('workspace-1')).toBe(sessionManager.sessions);

    getStatesSpy.mockRestore();
    backlogSpy.mockRestore();
    initializeSpy.mockRestore();
  });
});
