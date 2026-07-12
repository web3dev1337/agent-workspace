/**
 * Unit tests for SessionManager.resizeSession's skip/cooldown/re-assert behavior.
 * Same-size resizes are skipped within RESIZE_REASSERT_COOLDOWN_MS to avoid
 * needless ConPTY repaints, but re-applied after the cooldown in case the
 * OS-level resize silently failed (node-pty upstream won't-fix).
 */

jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

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

describe('SessionManager.resizeSession re-assert cooldown', () => {
  let sessionManager;
  let resize;
  let session;
  const sessionId = 'repo-work1-claude';

  beforeEach(() => {
    sessionManager = new SessionManager({ emit: jest.fn() }, null);
    resize = jest.fn();
    session = {
      id: sessionId,
      type: 'claude',
      pty: { killed: false, resize }
    };
    sessionManager.sessions.set(sessionId, session);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips a same-size resize within the cooldown window', () => {
    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(120, 40);

    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it('re-applies a same-size resize after the cooldown elapses', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);

    // Still within cooldown (59_999ms later).
    nowSpy.mockReturnValue(1_000_000 + SessionManager.RESIZE_REASSERT_COOLDOWN_MS - 1);
    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);

    // Cooldown has elapsed - re-assert even though size is unchanged.
    nowSpy.mockReturnValue(1_000_000 + SessionManager.RESIZE_REASSERT_COOLDOWN_MS);
    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('always applies a different-size resize and updates the cache', () => {
    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(session.lastAppliedCols).toBe(120);
    expect(session.lastAppliedRows).toBe(40);

    expect(sessionManager.resizeSession(sessionId, 160, 50)).toBe(true);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenLastCalledWith(160, 50);
    expect(session.lastAppliedCols).toBe(160);
    expect(session.lastAppliedRows).toBe(50);
  });

  it('returns false for a dead pty and does not call resize', () => {
    session.pty.killed = true;

    expect(sessionManager.resizeSession(sessionId, 120, 40)).toBe(false);
    expect(resize).not.toHaveBeenCalled();
    expect(session.pty).toBeNull();
    expect(session.status).toBe('dead');
  });

  it('returns false for an unknown session', () => {
    expect(sessionManager.resizeSession('does-not-exist', 120, 40)).toBe(false);
  });
});
