/**
 * Unit tests for CommanderService
 */

// Mock winston before requiring the service
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    simple: jest.fn()
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}));

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn()
    }
  }))
}));

const { CommanderService } = require('../../server/commanderService');

describe('CommanderService', () => {
  let service;
  const mockSessionManager = {
    getAllSessions: jest.fn(),
    getSession: jest.fn(),
    sendInput: jest.fn()
  };
  const mockWorkspaceManager = {
    listWorkspaces: jest.fn()
  };
  const mockPortRegistry = {
    getAllAssignments: jest.fn(),
    getOrAssignPort: jest.fn()
  };
  const mockGreenfieldService = {
    createProject: jest.fn()
  };
  const mockIo = {
    emit: jest.fn()
  };

  beforeEach(() => {
    // Clear singleton
    CommanderService.instance = null;
    jest.clearAllMocks();

    service = new CommanderService({
      apiKey: 'test-api-key',
      sessionManager: mockSessionManager,
      workspaceManager: mockWorkspaceManager,
      portRegistry: mockPortRegistry,
      greenfieldService: mockGreenfieldService,
      io: mockIo
    });
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = CommanderService.getInstance({});
      const instance2 = CommanderService.getInstance({});
      expect(instance1).toBe(instance2);
    });
  });

  describe('getStatus', () => {
    it('should return enabled status with API key', () => {
      const status = service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.apiKeyConfigured).toBe(true);
    });

    it('should return disabled status without API key', () => {
      CommanderService.instance = null;
      const noKeyService = new CommanderService({});
      const status = noKeyService.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.apiKeyConfigured).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should return array of tools', () => {
      const tools = service.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should have required tool properties', () => {
      const tools = service.getTools();
      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');
      });
    });

    it('should include create_project tool', () => {
      const tools = service.getTools();
      const createProject = tools.find(t => t.name === 'create_project');
      expect(createProject).toBeDefined();
    });

    it('should include list_workspaces tool', () => {
      const tools = service.getTools();
      const listWorkspaces = tools.find(t => t.name === 'list_workspaces');
      expect(listWorkspaces).toBeDefined();
    });
  });

  describe('clearHistory', () => {
    it('should clear conversation history', () => {
      service.conversationHistory = [{ role: 'user', content: 'test' }];
      service.clearHistory();
      expect(service.conversationHistory).toHaveLength(0);
    });
  });

  describe('tool execution', () => {
    describe('toolListWorkspaces', () => {
      it('should list workspaces', async () => {
        mockWorkspaceManager.listWorkspaces.mockResolvedValue([
          { id: 'ws1', name: 'Workspace 1', type: 'test', terminals: { pairs: 4 } }
        ]);

        const result = await service.toolListWorkspaces();
        expect(result.workspaces).toBeDefined();
        expect(result.workspaces[0].id).toBe('ws1');
      });

      it('should return error if workspace manager not available', async () => {
        service.workspaceManager = null;
        const result = await service.toolListWorkspaces();
        expect(result.error).toBeDefined();
      });
    });

    describe('toolListSessions', () => {
      it('should list sessions', async () => {
        mockSessionManager.getAllSessions.mockReturnValue([
          { id: 'session1', type: 'claude', status: 'active', branch: 'main' }
        ]);

        const result = await service.toolListSessions();
        expect(result.sessions).toBeDefined();
        expect(result.sessions[0].id).toBe('session1');
      });
    });

    describe('toolSendToTerminal', () => {
      it('should send input to terminal', async () => {
        mockSessionManager.getSession.mockReturnValue({ id: 'session1' });

        const result = await service.toolSendToTerminal({
          sessionId: 'session1',
          input: 'test command'
        });

        expect(result.success).toBe(true);
        expect(mockSessionManager.sendInput).toHaveBeenCalledWith('session1', 'test command\n');
      });

      it('should return error for non-existent session', async () => {
        mockSessionManager.getSession.mockReturnValue(null);

        const result = await service.toolSendToTerminal({
          sessionId: 'invalid',
          input: 'test'
        });

        expect(result.error).toContain('Session not found');
      });
    });

    describe('toolListPorts', () => {
      it('should list port assignments', async () => {
        mockPortRegistry.getAllAssignments.mockReturnValue([
          { port: 8080, repoPath: '/test', worktreeId: 'work1' }
        ]);

        const result = await service.toolListPorts();
        expect(result.ports).toBeDefined();
      });
    });

    describe('toolGetPort', () => {
      it('should get port for worktree', async () => {
        mockPortRegistry.getOrAssignPort.mockResolvedValue(8080);

        const result = await service.toolGetPort({
          repoPath: '/test',
          worktreeId: 'work1'
        });

        expect(result.port).toBe(8080);
      });
    });

    describe('toolSwitchWorkspace', () => {
      it('should emit workspace switch event', async () => {
        const result = await service.toolSwitchWorkspace({ workspaceId: 'ws1' });

        expect(result.success).toBe(true);
        expect(mockIo.emit).toHaveBeenCalledWith('commander-switch-workspace', { workspaceId: 'ws1' });
      });
    });

    describe('toolBroadcastMessage', () => {
      it('should broadcast to all Claude sessions', async () => {
        mockSessionManager.getAllSessions.mockReturnValue([
          { id: 'claude1', type: 'claude' },
          { id: 'server1', type: 'server' },
          { id: 'claude2', type: 'claude' }
        ]);

        const result = await service.toolBroadcastMessage({ message: 'Hello all!' });

        expect(result.success).toBe(true);
        expect(result.message).toContain('2 Claude sessions');
        expect(mockSessionManager.sendInput).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('processCommand without API key', () => {
    it('should return simulated response', async () => {
      service.client = null;
      const result = await service.processCommand('test input');

      expect(result.response).toContain('Commander would process');
      expect(result.response).toContain('ANTHROPIC_API_KEY not configured');
    });
  });
});
