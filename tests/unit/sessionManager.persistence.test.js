jest.mock('../../server/sessionRecoveryService', () => ({
  clearSession: jest.fn(),
  updateSession: jest.fn(),
  updateAgent: jest.fn(),
  updateCwd: jest.fn(),
  updateConversation: jest.fn(),
  updateServer: jest.fn(),
  getSession: jest.fn(),
  getAllSessions: jest.fn(),
  init: jest.fn(),
  loadWorkspaceState: jest.fn(),
  getRecoveryInfo: jest.fn(),
  clearWorkspace: jest.fn(),
  markAgentInactive: jest.fn()
}));

const { SessionManager } = require('../../server/sessionManager');

const makeManager = () => {
  const io = { emit: jest.fn() };
  const sm = new SessionManager(io, null);
  sm.sessionPersistenceEnabled = true;
  sm.sessionPersistence = {
    socketName: 'test-sock',
    panePid: jest.fn(() => 4242),
    killSession: jest.fn(() => true),
    listSessionNames: jest.fn(() => []),
    capturePane: jest.fn(() => ''),
    hasSession: jest.fn(() => false)
  };
  return { sm, io };
};

describe('SessionManager session persistence', () => {
  test('getSessionProcessPid prefers the tmux pane pid for persistent sessions', () => {
    const { sm } = makeManager();
    const session = { id: 's1', persistence: { backend: 'tmux', name: 's1' }, pty: { pid: 111 } };
    expect(sm.getSessionProcessPid(session)).toBe(4242);
    expect(sm.sessionPersistence.panePid).toHaveBeenCalledWith('s1');
  });

  test('getSessionProcessPid falls back to the pty pid for direct sessions', () => {
    const { sm } = makeManager();
    expect(sm.getSessionProcessPid({ id: 's2', pty: { pid: 222 } })).toBe(222);
    expect(sm.sessionPersistence.panePid).not.toHaveBeenCalled();
  });

  test('getSessionProcessPid falls back to the pty pid when the pane query fails', () => {
    const { sm } = makeManager();
    sm.sessionPersistence.panePid.mockReturnValue(null);
    const session = { id: 's3', persistence: { backend: 'tmux', name: 's3' }, pty: { pid: 333 } };
    expect(sm.getSessionProcessPid(session)).toBe(333);
  });

  test('destroyPersistentSession kills the tmux session only for persistent sessions', () => {
    const { sm } = makeManager();
    sm.destroyPersistentSession({ id: 'plain', pty: {} });
    expect(sm.sessionPersistence.killSession).not.toHaveBeenCalled();

    sm.destroyPersistentSession({ id: 'persisted', persistence: { backend: 'tmux', name: 'persisted' } });
    expect(sm.sessionPersistence.killSession).toHaveBeenCalledWith('persisted');
  });

  test('terminateSession destroys the backing tmux session and tree-kills the pane pid', () => {
    const { sm } = makeManager();
    const ptyKill = jest.fn();
    sm.sessions.set('work1-claude', {
      id: 'work1-claude',
      type: 'claude',
      workspace: 'ws1',
      persistence: { backend: 'tmux', name: 'work1-claude' },
      pty: { pid: 555, kill: ptyKill }
    });
    const treeKill = jest.spyOn(sm, 'bestEffortKillProcessTree').mockImplementation(() => {});

    sm.terminateSession('work1-claude');

    expect(sm.sessionPersistence.killSession).toHaveBeenCalledWith('work1-claude');
    expect(ptyKill).toHaveBeenCalled();
    expect(treeKill).toHaveBeenCalledWith(4242, { sessionId: 'work1-claude' });
    treeKill.mockRestore();
  });

  test('getPersistenceStatus separates managed sessions from orphans', () => {
    const { sm } = makeManager();
    sm.sessions.set('a-claude', { id: 'a-claude', persistence: { backend: 'tmux', name: 'a-claude' }, pty: {} });
    const stashed = new Map();
    stashed.set('b-server', { id: 'b-server', persistence: { backend: 'tmux', name: 'b-server' }, pty: {} });
    sm.workspaceSessionMaps.set('ws2', stashed);
    sm.sessionPersistence.listSessionNames.mockReturnValue(['a-claude', 'b-server', 'stray-work9-claude']);

    const status = sm.getPersistenceStatus();
    expect(status.enabled).toBe(true);
    expect(status.managed).toEqual(expect.arrayContaining([
      { name: 'a-claude', sessionId: 'a-claude' },
      { name: 'b-server', sessionId: 'b-server' }
    ]));
    expect(status.orphaned).toEqual([{ name: 'stray-work9-claude' }]);
  });

  test('writeToSession strips echoed device-attribute reports for tmux sessions', () => {
    const { sm } = makeManager();
    const writes = [];
    sm.sessions.set('work1-claude', {
      id: 'work1-claude',
      type: 'claude',
      persistence: { backend: 'tmux', name: 'work1-claude' },
      pty: { write: (d) => writes.push(d) }
    });

    sm.writeToSession('work1-claude', '\x1b[?1;2c\x1b[>0;276;0cls\r');
    expect(writes).toEqual(['ls\r']); // DA reports removed, real keystroke kept
  });

  test('writeToSession leaves input untouched for non-persistent (direct pty) sessions', () => {
    const { sm } = makeManager();
    sm.sessionPersistenceEnabled = false;
    const writes = [];
    sm.sessions.set('work2-claude', {
      id: 'work2-claude',
      type: 'claude',
      pty: { write: (d) => writes.push(d) }
    });

    sm.writeToSession('work2-claude', '\x1b[?1;2cls\r');
    expect(writes).toEqual(['\x1b[?1;2cls\r']); // no stripping without tmux
  });

  test('getPersistenceStatus reports disabled cleanly', () => {
    const { sm } = makeManager();
    sm.sessionPersistenceEnabled = false;
    expect(sm.getPersistenceStatus()).toEqual({
      enabled: false,
      backend: 'tmux',
      socketName: 'test-sock',
      managed: [],
      orphaned: []
    });
  });
});
