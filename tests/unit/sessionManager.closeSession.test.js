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
  clearWorkspace: jest.fn()
}));

const sessionRecoveryService = require('../../server/sessionRecoveryService');
const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager.closeSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('closes active session and clears recovery when requested', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    sm.sessions.set('work1-server', {
      id: 'work1-server',
      type: 'server',
      workspace: 'ws1',
      pty: null
    });

    const ok = sm.closeSession('work1-server', { clearRecovery: true });
    expect(ok).toBe(true);
    expect(sm.sessions.has('work1-server')).toBe(false);
    expect(sessionRecoveryService.clearSession).toHaveBeenCalledWith('ws1', 'work1-server');
  });

  test('closes stashed workspace session and clears recovery when requested', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    const stashed = new Map();
    stashed.set('work2-claude', {
      id: 'work2-claude',
      type: 'claude',
      workspace: 'ws2',
      pty: null
    });
    sm.workspaceSessionMaps.set('ws2', stashed);

    const ok = sm.closeSession('work2-claude', { clearRecovery: true });
    expect(ok).toBe(true);
    expect(stashed.has('work2-claude')).toBe(false);
    expect(sessionRecoveryService.clearSession).toHaveBeenCalledWith('ws2', 'work2-claude');
  });
});

