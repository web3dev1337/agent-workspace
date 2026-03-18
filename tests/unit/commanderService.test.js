/**
 * Unit tests for CommanderService
 */

const { CommanderService } = require('../../server/commanderService');

describe('CommanderService', () => {
  let service;

  beforeEach(() => {
    jest.useFakeTimers();
    // Clear singleton for testing
    CommanderService.instance = null;
    service = CommanderService.getInstance({ io: null, sessionManager: null });
  });

  afterEach(() => {
    // Stop any running sessions
    if (service.session) {
      service.stop();
    }
    CommanderService.instance = null;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = CommanderService.getInstance();
      const instance2 = CommanderService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getStatus', () => {
    it('should return stopped status when not running', () => {
      const status = service.getStatus();
      expect(status.running).toBe(false);
      expect(status.ready).toBe(false);
      expect(status.status).toBe('stopped');
    });

    it('should include cwd in status', () => {
      const status = service.getStatus();
      expect(status.cwd).toBeDefined();
      expect(typeof status.cwd).toBe('string');
    });
  });

  describe('sendInput', () => {
    it('should return false when not running', () => {
      const result = service.sendInput('test');
      expect(result).toBe(false);
    });
  });

  describe('stop', () => {
    it('should return error when not running', () => {
      const result = service.stop();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not running');
    });
  });

  describe('getRecentOutput', () => {
    it('should return empty string when no output', () => {
      const output = service.getRecentOutput();
      expect(output).toBe('');
    });

    it('should return recent lines from buffer', () => {
      service.outputBuffer = 'line1\nline2\nline3';
      const output = service.getRecentOutput(2);
      expect(output).toBe('line2\nline3');
    });
  });

  describe('clearBuffer', () => {
    it('should clear output buffer', () => {
      service.outputBuffer = 'line1\nline2';
      service.clearBuffer();
      expect(service.outputBuffer).toBe('');
    });
  });

  describe('Claude trust flow', () => {
    it('queues commander input until Claude is ready and auto-accepts trust prompt', () => {
      const writes = [];
      service.session = {
        id: 'commander',
        pty: {
          write: (data) => writes.push(data),
          kill: jest.fn()
        }
      };
      service.claudeStarted = true;
      service.beginClaudeLaunch({ expectTrustPrompt: true });

      expect(service.sendInput('ship it\n')).toBe(true);
      expect(writes).toEqual([]);

      service.handleClaudeLaunchOutput('Quick safety check: Is this a project you created or one you trust?\n1. Yes, I trust this folder');
      expect(writes).toEqual(['1\r']);

      service.handleClaudeLaunchOutput('Welcome to Claude Code!\n? for shortcuts');
      expect(writes).toEqual(['1\r', 'ship it\n']);
      expect(service.claudeLaunchState).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('should return empty array when sessionManager not available', () => {
      const sessions = service.listSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBe(0);
    });

    it('should return sessions when sessionManager has sessions', () => {
      // Create mock sessionManager with sessions
      const mockSessions = new Map([
        ['session1', { id: 'session1', type: 'claude', status: 'idle' }],
        ['session2', { id: 'session2', type: 'server', status: 'running' }]
      ]);

      service.sessionManager = { sessions: mockSessions };

      const sessions = service.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe('session1');
    });
  });

  describe('sendToSession', () => {
    it('should return false when sessionManager not available', () => {
      const result = service.sendToSession('session1', 'test');
      expect(result).toBe(false);
    });

    it('should return false for non-existent session', () => {
      service.sessionManager = { sessions: new Map() };
      const result = service.sendToSession('nonexistent', 'test');
      expect(result).toBe(false);
    });

    it('should send input to session with pty', () => {
      let sentData = null;
      const mockPty = {
        write: (data) => { sentData = data; }
      };

      service.sessionManager = {
        sessions: new Map([
          ['session1', { id: 'session1', pty: mockPty }]
        ])
      };

      const result = service.sendToSession('session1', 'test input');
      expect(result).toBe(true);
      expect(sentData).toBe('test input');
    });
  });

  describe('resize', () => {
    it('should return false when not running', () => {
      const result = service.resize(120, 40);
      expect(result).toBe(false);
    });
  });
});
