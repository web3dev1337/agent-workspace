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
  clearWorkspace: jest.fn()
}));

const sessionRecoveryService = require('../../server/sessionRecoveryService');
const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager.closeSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('closes active session and clears recovery when requested', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    sm.sessions.set('work1-server', {
      id: 'work1-server',
      type: 'server',
      workspace: 'ws1',
      pty: null
    });

    const ok = sm.closeSession('work1-server', { clearRecovery: true });
    expect(ok).toBe(true);
    expect(sm.sessions.has('work1-server')).toBe(false);
    expect(sessionRecoveryService.clearSession).toHaveBeenCalledWith('ws1', 'work1-server');
  });

  test('closes stashed workspace session and clears recovery when requested', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    const stashed = new Map();
    stashed.set('work2-claude', {
      id: 'work2-claude',
      type: 'claude',
      workspace: 'ws2',
      pty: null
    });
    sm.workspaceSessionMaps.set('ws2', stashed);

    const ok = sm.closeSession('work2-claude', { clearRecovery: true });
    expect(ok).toBe(true);
    expect(stashed.has('work2-claude')).toBe(false);
    expect(sessionRecoveryService.clearSession).toHaveBeenCalledWith('ws2', 'work2-claude');
  });

  test('resolves worktree group session ids in active workspace', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    sm.sessions.set('zoo-game-work2-claude', {
      id: 'zoo-game-work2-claude',
      type: 'claude',
      workspace: 'ws1',
      repositoryName: 'zoo-game',
      worktreeId: 'work2',
      pty: null
    });
    sm.sessions.set('zoo-game-work2-server', {
      id: 'zoo-game-work2-server',
      type: 'server',
      workspace: 'ws1',
      repositoryName: 'zoo-game',
      worktreeId: 'work2',
      pty: null
    });
    sm.sessions.set('zoo-game-work3-claude', {
      id: 'zoo-game-work3-claude',
      type: 'claude',
      workspace: 'ws1',
      repositoryName: 'zoo-game',
      worktreeId: 'work3',
      pty: null
    });

    const byRepoKey = sm.getSessionIdsForWorktree({ workspaceId: 'ws1', worktreeKey: 'zoo-game-work2' });
    expect(byRepoKey).toEqual(['zoo-game-work2-claude', 'zoo-game-work2-server']);

    const byWorktreeToken = sm.getSessionIdsForWorktree({ workspaceId: 'ws1', worktreeKey: 'work2' });
    expect(byWorktreeToken).toEqual(['zoo-game-work2-claude', 'zoo-game-work2-server']);
  });

  test('resolves worktree group session ids from stashed workspace sessions', () => {
    const io = { emit: jest.fn() };
    const sm = new SessionManager(io, null);

    const stashed = new Map();
    stashed.set('hytopia-work7-claude', {
      id: 'hytopia-work7-claude',
      type: 'claude',
      workspace: 'ws2',
      repositoryName: 'hytopia',
      worktreeId: 'work7',
      pty: null
    });
    stashed.set('hytopia-work7-server', {
      id: 'hytopia-work7-server',
      type: 'server',
      workspace: 'ws2',
      repositoryName: 'hytopia',
      worktreeId: 'work7',
      pty: null
    });
    sm.workspaceSessionMaps.set('ws2', stashed);

    const ids = sm.getSessionIdsForWorktree({ workspaceId: 'ws2', worktreeKey: 'hytopia-work7' });
    expect(ids).toEqual(['hytopia-work7-claude', 'hytopia-work7-server']);
  });
});
