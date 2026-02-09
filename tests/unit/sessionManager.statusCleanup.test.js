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
  clearAgent: jest.fn()
}));

const sessionRecoveryService = require('../../server/sessionRecoveryService');
const { SessionManager } = require('../../server/sessionManager');
const { StatusDetector } = require('../../server/statusDetector');

describe('SessionManager refreshSessionStatus stale-agent cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('clears stale recovery agent markers when terminal is clearly back to shell', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);
    sm.setStatusDetector(new StatusDetector());

    const sessionId = 'work1-claude';
    const session = {
      id: sessionId,
      type: 'claude',
      workspace: 'ws1',
      status: 'idle',
      statusChangedAt: Date.now() - 10000,
      buffer: '\u001b[32mab@host\u001b[0m:\u001b[34m~/repo\u001b[0m$ '
    };

    sm.sessions.set(sessionId, session);
    sessionRecoveryService.getSession.mockReturnValue({
      lastAgent: 'claude'
    });

    sm.refreshSessionStatus(sessionId, session);

    expect(sessionRecoveryService.clearAgent).toHaveBeenCalledWith('ws1', sessionId);
  });
});
