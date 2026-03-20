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

describe('SessionManager Claude trust prompt handling', () => {
  it('auto-accepts the Claude trust prompt once after launch', () => {
    const sessionManager = new SessionManager({ emit: jest.fn() }, null);
    const write = jest.fn();
    const session = {
      id: 'repo-work1-claude',
      type: 'claude',
      pty: { write }
    };

    sessionManager.beginClaudeLaunch(session, { expectTrustPrompt: true });
    sessionManager.maybeHandleClaudeTrustPrompt(
      session,
      'Quick safety check: Is this a project you created or one you trust?\n1. I trust this folder'
    );

    expect(write).toHaveBeenCalledWith('1\r');
    expect(session.claudeLaunchState).toBeNull();
  });
});
