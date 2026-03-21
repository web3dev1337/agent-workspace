const fs = require('fs');
const path = require('path');
const { patchNodePtyStartProcessCompat } = require('../../server/utils/processUtils');

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

function createNodePtyMock() {
  return {
    spawn: jest.fn(() => ({
      pid: 1234,
      onData: jest.fn(),
      onExit: jest.fn(),
      kill: jest.fn()
    }))
  };
}

function mockWinston() {
  return {
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    })),
    format: {
      combine: jest.fn(() => ({})),
      timestamp: jest.fn(() => ({})),
      json: jest.fn(() => ({})),
      simple: jest.fn(() => ({})),
      errors: jest.fn(() => ({}))
    },
    transports: {
      File: jest.fn(),
      Console: jest.fn()
    }
  };
}

function mockSessionRecoveryService() {
  return {
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
  };
}

function loadSessionManagerForWindows() {
  jest.resetModules();
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });

  let nodePty = null;
  let SessionManager = null;

  jest.doMock('node-pty', () => {
    nodePty = createNodePtyMock();
    return nodePty;
  });
  jest.doMock('winston', () => mockWinston(), { virtual: true });
  jest.doMock('../../server/sessionRecoveryService', () => mockSessionRecoveryService());

  jest.isolateModules(() => {
    ({ SessionManager } = require('../../server/sessionManager'));
  });

  return {
    SessionManager,
    nodePty
  };
}

describe('SessionManager Windows PTY options', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  it('enables ConPTY for Windows sessions and cleans up workspace-specific sessions', () => {
    const { SessionManager, nodePty } = loadSessionManagerForWindows();

    const io = { emit: jest.fn() };
    const sessionManager = new SessionManager(io, null);
    sessionManager.workspace = { id: 'workspace-1', name: 'Workspace 1' };

    sessionManager.createSession('workspace-1-server', {
      type: 'server',
      command: 'powershell.exe',
      args: ['-NoExit'],
      cwd: 'C:\\repo',
      worktreeId: 'work1'
    });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoExit'],
      expect.objectContaining({
        cwd: 'C:\\repo'
      })
    );
    const passedOpts = nodePty.spawn.mock.calls[0][2];
    expect(passedOpts).not.toHaveProperty('useConpty');

    const activeSession = sessionManager.getSessionById('workspace-1-server');
    expect(activeSession).toBeTruthy();

    sessionManager.workspaceSessionMaps.set('workspace-2', new Map([
      ['workspace-2-server', {
        id: 'workspace-2-server',
        workspace: 'workspace-2',
        pty: { kill: jest.fn() }
      }]
    ]));

    const closed = sessionManager.cleanupWorkspaceSessions('workspace-2');
    expect(closed).toBe(1);
    expect(sessionManager.workspaceSessionMaps.has('workspace-2')).toBe(false);

    expect(sessionManager.closeSession('workspace-1-server')).toBe(true);
  });

  it('patches the broken Windows node-pty startProcess wrapper', () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((targetPath) => (
      targetPath === path.join('C:\\node_modules\\node-pty', 'lib', 'windowsPtyAgent.js')
    ));
    const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(
      'before conptyNative.startProcess(file, cols, rows, debug, this._generatePipeName(), conptyInheritCursor, this._useConptyDll) middle conptyNative.connect(pty, commandLine, cwd, env, this._useConptyDll, function (c) { return _this._$onProcessExit(c); }) after'
    );
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const result = patchNodePtyStartProcessCompat('C:\\node_modules\\node-pty');

    expect(result).toEqual({
      status: 'patched',
      agentPath: path.join('C:\\node_modules\\node-pty', 'lib', 'windowsPtyAgent.js')
    });
    expect(writeSpy).toHaveBeenCalledWith(
      path.join('C:\\node_modules\\node-pty', 'lib', 'windowsPtyAgent.js'),
      'before conptyNative.startProcess(file, cols, rows, debug, this._generatePipeName(), conptyInheritCursor) middle conptyNative.connect(pty, commandLine, cwd, env, function (c) { return _this._$onProcessExit(c); }) after',
      'utf8'
    );

    writeSpy.mockRestore();
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });
});
