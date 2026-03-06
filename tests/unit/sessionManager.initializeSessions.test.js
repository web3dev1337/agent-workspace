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

  test('uses hidden PowerShell startup args for Windows sessions', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    });

    jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);

    const io = { emit: jest.fn() };
    const agentManager = { getAllAgents: () => [] };
    const sm = new SessionManager(io, agentManager);

    sm.workspace = {
      name: 'test',
      worktrees: { enabled: false, autoCreate: false },
      terminals: { pairs: 1 }
    };
    sm.worktrees = [
      { id: 'work1', path: 'C:\\test\\work1' }
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

    try {
      await sm.initializeSessions({ preserveExisting: true });
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform
      });
    }

    const claudeConfig = sm.createSession.mock.calls.find(([sessionId]) => sessionId === 'work1-claude')?.[1];
    const serverConfig = sm.createSession.mock.calls.find(([sessionId]) => sessionId === 'work1-server')?.[1];

    expect(claudeConfig).toBeTruthy();
    expect(serverConfig).toBeTruthy();
    expect(claudeConfig.command).toBe('powershell.exe');
    expect(serverConfig.command).toBe('powershell.exe');
    expect(claudeConfig.args.slice(0, 4)).toEqual(['-WindowStyle', 'Hidden', '-NoLogo', '-NoExit']);
    expect(serverConfig.args.slice(0, 4)).toEqual(['-WindowStyle', 'Hidden', '-NoLogo', '-NoExit']);
    expect(claudeConfig.args).toContain('-Command');
    expect(serverConfig.args).toContain('-Command');
  });
});
