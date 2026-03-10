jest.mock('winston', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  return {
    createLogger: jest.fn(() => logger),
    format: {
      combine: jest.fn(() => ({})),
      timestamp: jest.fn(() => ({})),
      errors: jest.fn(() => ({})),
      json: jest.fn(() => ({})),
      simple: jest.fn(() => ({})),
      colorize: jest.fn(() => ({})),
      printf: jest.fn(() => ({}))
    },
    transports: {
      File: jest.fn(),
      Console: jest.fn()
    }
  };
}, { virtual: true });

const { PrReviewAutomationService } = require('../../server/prReviewAutomationService');
const { SessionManager } = require('../../server/sessionManager');

const makeAutomationService = ({
  diagnosticsTools = [
    { id: 'claude', ok: true },
    { id: 'codex', ok: true }
  ]
} = {}) => {
  const workspace = {
    id: 'ws-review',
    terminals: [
      {
        id: 'demo-work1-claude',
        worktreeId: 'work1',
        repository: { name: 'demo' }
      }
    ]
  };

  const sessionManager = {
    startAgentWithConfig: jest.fn().mockReturnValue(true),
    writeToSession: jest.fn(),
    getSessionById: jest.fn(),
    getAllSessionEntries: jest.fn(() => [])
  };

  const taskRecordService = {
    get: jest.fn(() => null),
    upsert: jest.fn()
  };

  const workspaceManager = {
    getActiveWorkspace: jest.fn(() => ({ id: workspace.id })),
    getWorkspaceById: jest.fn(() => workspace)
  };

  const service = new PrReviewAutomationService({
    sessionManager,
    taskRecordService,
    workspaceManager,
    collectDiagnostics: jest.fn(async () => ({ tools: diagnosticsTools }))
  });

  return {
    service,
    sessionManager,
    taskRecordService,
    workspaceManager
  };
};

describe('PrReviewAutomationService reviewer launch config', () => {
  test('normalizes automation-only reviewer config for Codex and Claude', () => {
    const service = new PrReviewAutomationService();

    const codex = service._resolveReviewerConfig({
      reviewerAgent: 'codex',
      reviewerMode: 'resume',
      reviewerCodexModel: 'latest',
      reviewerCodexReasoning: 'xhigh',
      reviewerCodexVerbosity: 'high',
      reviewerCodexFlags: ['yolo']
    });
    expect(codex.agentId).toBe('codex');
    expect(codex.mode).toBe('continue');
    expect(codex.model).toBeUndefined();
    expect(codex.reasoning).toBe('xhigh');
    expect(codex.verbosity).toBe('high');

    const claude = service._resolveReviewerConfig({
      reviewerAgent: 'claude',
      reviewerMode: 'resume',
      reviewerClaudeModel: 'opus',
      reviewerSkipPermissions: true
    });
    expect(claude.agentId).toBe('claude');
    expect(claude.mode).toBe('continue');
    expect(claude.model).toBe('opus');
    expect(claude.flags).toEqual(['skipPermissions']);
  });
});

describe('PrReviewAutomationService reviewer spawning', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('launches Codex in the existing agent shell when no -codex session exists', async () => {
    const { service, sessionManager } = makeAutomationService();
    sessionManager.getSessionById.mockImplementation((sessionId) => {
      if (sessionId === 'demo-work1-claude') {
        return { status: 'idle' };
      }
      return null;
    });

    const ok = await service._spawnReviewerForPr(
      {
        prId: 'pr:acme/demo#12',
        owner: 'acme',
        repo: 'demo',
        number: 12,
        title: 'Review me'
      },
      {
        reviewerAgent: 'codex',
        reviewerMode: 'fresh',
        reviewerCodexFlags: ['yolo']
      }
    );

    expect(ok).toBe(true);
    expect(sessionManager.startAgentWithConfig).toHaveBeenCalledWith(
      'demo-work1-claude',
      expect.objectContaining({
        agentId: 'codex',
        mode: 'fresh',
        flags: ['yolo']
      })
    );

    jest.runOnlyPendingTimers();
    expect(sessionManager.writeToSession).toHaveBeenCalledWith(
      'demo-work1-claude',
      expect.stringContaining('gh pr diff 12')
    );
  });

  test('falls back to Claude when Codex is not installed', async () => {
    const { service, sessionManager } = makeAutomationService({
      diagnosticsTools: [
        { id: 'claude', ok: true },
        { id: 'codex', ok: false }
      ]
    });
    sessionManager.getSessionById.mockImplementation((sessionId) => {
      if (sessionId === 'demo-work1-claude') {
        return { status: 'idle' };
      }
      return null;
    });

    const ok = await service._spawnReviewerForPr(
      {
        prId: 'pr:acme/demo#42',
        owner: 'acme',
        repo: 'demo',
        number: 42,
        title: 'Fallback me'
      },
      {
        reviewerAgent: 'codex',
        reviewerMode: 'fresh',
        reviewerSkipPermissions: true
      }
    );

    expect(ok).toBe(true);
    expect(sessionManager.startAgentWithConfig).toHaveBeenCalledWith(
      'demo-work1-claude',
      expect.objectContaining({
        agentId: 'claude',
        mode: 'fresh',
        flags: ['skipPermissions']
      })
    );
  });
});

describe('SessionManager.buildClaudeCommand', () => {
  test('includes explicit model aliases in Claude launches', () => {
    const sessionManager = new SessionManager({ emit: jest.fn() }, { getAllAgents: () => [] });

    const command = sessionManager.buildClaudeCommand({
      shellKind: 'bash',
      mode: 'fresh',
      model: 'opus',
      skipPermissions: true
    });

    expect(command).toBe("claude --model 'opus' --dangerously-skip-permissions");
  });
});
