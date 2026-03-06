jest.mock('../../server/claudeVersionChecker', () => ({
  ClaudeVersionChecker: {
    checkVersion: jest.fn().mockResolvedValue({
      version: '1.0.24',
      isCompatible: true
    })
  }
}));

const fs = require('fs');
const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager.initializeSessions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('updates each single-repo worktree branch only once during initialization', async () => {
    jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);

    const io = { emit: jest.fn() };
    const agentManager = { getAllAgents: () => [] };
    const sm = new SessionManager(io, agentManager);

    sm.workspace = {
      name: 'test',
      worktrees: { enabled: false, autoCreate: false },
      terminals: { pairs: 2 }
    };
    sm.worktrees = [
      { id: 'work1', path: '/tmp/test/work1' },
      { id: 'work2', path: '/tmp/test/work2' }
    ];
    sm.sessions = new Map();
    sm.gitHelper = {};
    sm.cleanupAllSessions = jest.fn();
    sm.stopBranchRefresh = jest.fn();
    sm.cleanupGitWatchers = jest.fn();
    sm.startBranchRefresh = jest.fn();
    sm.setupGitWatchers = jest.fn();
    sm.createSession = jest.fn((sessionId, config) => {
      sm.sessions.set(sessionId, {
        id: sessionId,
        type: config.type,
        worktreeId: config.worktreeId,
        config
      });
    });
    sm.updateGitBranch = jest.fn().mockResolvedValue(undefined);

    await sm.initializeSessions({ preserveExisting: true });

    expect(sm.createSession).toHaveBeenCalledTimes(4);
    expect(sm.updateGitBranch).toHaveBeenCalledTimes(2);
    expect(sm.updateGitBranch).toHaveBeenNthCalledWith(1, 'work1', '/tmp/test/work1');
    expect(sm.updateGitBranch).toHaveBeenNthCalledWith(2, 'work2', '/tmp/test/work2');
  });
});
