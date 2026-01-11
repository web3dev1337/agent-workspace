/**
 * Unit tests for CommanderService (Terminal-based)
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

// Mock node-pty
const mockPty = {
  write: jest.fn(),
  kill: jest.fn(),
  resize: jest.fn(),
  onData: jest.fn(),
  onExit: jest.fn()
};

jest.mock('node-pty', () => ({
  spawn: jest.fn(() => mockPty)
}));

const { CommanderService } = require('../../server/commanderService');

describe('CommanderService', () => {
  let service;
  const mockSessions = new Map();
  const mockSessionManager = {
    sessions: mockSessions
  };
  const mockIo = {
    emit: jest.fn()
  };

  beforeEach(() => {
    // Clear singleton
    CommanderService.instance = null;
    jest.clearAllMocks();

    service = new CommanderService({
      sessionManager: mockSessionManager,
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
    it('should return stopped status when not running', () => {
      const status = service.getStatus();
      expect(status.running).toBe(false);
      expect(status.status).toBe('stopped');
    });

    it('should return running status after start', async () => {
      await service.start();
      const status = service.getStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('start', () => {
    it('should spawn a pty process', async () => {
      const result = await service.start();
      expect(result.success).toBe(true);
      expect(require('node-pty').spawn).toHaveBeenCalled();
    });

    it('should return error if already running', async () => {
      await service.start();
      const result = await service.start();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Already running');
    });
  });

  describe('stop', () => {
    it('should kill the pty process', async () => {
      await service.start();
      const result = service.stop();
      expect(result.success).toBe(true);
      expect(mockPty.kill).toHaveBeenCalled();
    });

    it('should return error if not running', () => {
      const result = service.stop();
      expect(result.success).toBe(false);
    });
  });

  describe('sendInput', () => {
    it('should write to pty', async () => {
      await service.start();
      const success = service.sendInput('test command\n');
      expect(success).toBe(true);
      expect(mockPty.write).toHaveBeenCalledWith('test command\n');
    });

    it('should return false if not running', () => {
      const success = service.sendInput('test');
      expect(success).toBe(false);
    });
  });

  describe('resize', () => {
    it('should resize pty', async () => {
      await service.start();
      const success = service.resize(100, 50);
      expect(success).toBe(true);
      expect(mockPty.resize).toHaveBeenCalledWith(100, 50);
    });

    it('should return false if not running', () => {
      const success = service.resize(100, 50);
      expect(success).toBe(false);
    });
  });

  describe('output buffer', () => {
    it('should add to output buffer', () => {
      service.addToOutputBuffer('line1\nline2\n');
      const output = service.getRecentOutput(10);
      expect(output).toContain('line1');
    });

    it('should trim buffer when too large', () => {
      // Add more than maxBufferLines
      for (let i = 0; i < 600; i++) {
        service.addToOutputBuffer(`line ${i}\n`);
      }
      expect(service.outputBuffer.length).toBeLessThanOrEqual(500);
    });

    it('should clear buffer', () => {
      service.addToOutputBuffer('test');
      service.clearBuffer();
      expect(service.outputBuffer).toHaveLength(0);
    });
  });

  describe('listSessions', () => {
    it('should return mapped sessions', () => {
      mockSessions.clear();
      mockSessions.set('s1', {
        id: 's1', type: 'claude', status: 'active', branch: 'main', worktreeId: 'work1'
      });

      const sessions = service.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('s1');
    });

    it('should return empty array if no session manager', () => {
      service.sessionManager = null;
      const sessions = service.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('sendToSession', () => {
    it('should send input to another session', () => {
      const mockPtyTarget = { write: jest.fn() };
      mockSessions.clear();
      mockSessions.set('s1', { id: 's1', pty: mockPtyTarget });

      const success = service.sendToSession('s1', 'hello');
      expect(success).toBe(true);
      expect(mockPtyTarget.write).toHaveBeenCalledWith('hello');
    });

    it('should return false if session not found', () => {
      mockSessions.clear();

      const success = service.sendToSession('invalid', 'hello');
      expect(success).toBe(false);
    });
  });

  describe('startClaude', () => {
    it('should start terminal and send claude command', async () => {
      await service.startClaude('fresh');
      expect(mockPty.write).toHaveBeenCalledWith('claude\n');
    });

    it('should send --continue flag', async () => {
      await service.startClaude('continue');
      expect(mockPty.write).toHaveBeenCalledWith('claude --continue\n');
    });

    it('should send --resume flag', async () => {
      await service.startClaude('resume');
      expect(mockPty.write).toHaveBeenCalledWith('claude --resume\n');
    });
  });
});
