jest.mock('node-pty', () => ({
  spawn: jest.fn()
}), { virtual: true });

jest.mock('winston', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }),
  format: {
    combine: jest.fn(() => ({})),
    timestamp: jest.fn(() => ({})),
    errors: jest.fn(() => ({})),
    json: jest.fn(() => ({})),
    simple: jest.fn(() => ({})),
    colorize: jest.fn(() => ({}))
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}), { virtual: true });

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
  markAgentInactive: jest.fn(),
  clearAgent: jest.fn()
}));

const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager agent detection', () => {
  it('detects gemini commands directly', () => {
    const sessionManager = new SessionManager({ emit: jest.fn() }, null);
    expect(sessionManager.detectAgentFromCommand('gemini', [], 'gemini')).toBe('gemini');
  });

  it('detects gemini commands launched through npm exec', () => {
    const sessionManager = new SessionManager({ emit: jest.fn() }, null);
    expect(
      sessionManager.detectAgentFromCommand('npm', ['exec', 'gemini'], 'npm exec gemini')
    ).toBe('gemini');
  });
});
