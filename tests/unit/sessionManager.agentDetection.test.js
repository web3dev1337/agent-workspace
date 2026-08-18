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

describe('SessionManager isAutoRunAgentCommand', () => {
  const sm = () => new SessionManager({ emit: jest.fn() }, null);

  it('plain interactive launches are not auto-run', () => {
    expect(sm().isAutoRunAgentCommand('claude', ['--dangerously-skip-permissions'])).toBe(false);
    expect(sm().isAutoRunAgentCommand('codex', ['--dangerously-bypass-approvals-and-sandbox'])).toBe(false);
    expect(sm().isAutoRunAgentCommand('claude', [])).toBe(false);
  });

  it('flag values are not mistaken for prompts', () => {
    expect(sm().isAutoRunAgentCommand('codex', ['-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=ultra', '--dangerously-bypass-approvals-and-sandbox'])).toBe(false);
    expect(sm().isAutoRunAgentCommand('claude', ['--model', 'opus'])).toBe(false);
  });

  it('resume/continue subcommands stay idle', () => {
    expect(sm().isAutoRunAgentCommand('codex', ['resume', '--last'])).toBe(false);
    expect(sm().isAutoRunAgentCommand('claude', ['--continue'])).toBe(false);
  });

  it('print mode and exec are auto-run', () => {
    expect(sm().isAutoRunAgentCommand('claude', ['-p', 'do the thing'])).toBe(true);
    expect(sm().isAutoRunAgentCommand('codex', ['exec', 'fix the bug'])).toBe(true);
  });

  it('positional prompt is auto-run', () => {
    expect(sm().isAutoRunAgentCommand('claude', ['build me a game'])).toBe(true);
  });
});
