jest.mock('node-pty', () => ({
  spawn: jest.fn(() => ({
    pid: 1234,
    onData: jest.fn(),
    onExit: jest.fn(),
    kill: jest.fn()
  }))
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

const nodePty = require('node-pty');
const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager Windows PTY options', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  it('enables ConPTY for Windows sessions and cleans up workspace-specific sessions', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

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
        cwd: 'C:\\repo',
        useConpty: true
      })
    );

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
});
