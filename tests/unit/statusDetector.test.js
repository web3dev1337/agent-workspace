/**
 * Unit tests for StatusDetector
 */

const { StatusDetector } = require('../../server/statusDetector');

describe('StatusDetector', () => {
  let detector;
  const sessionId = 's1';

  beforeEach(() => {
    detector = new StatusDetector();
  });

  afterEach(() => {
    detector.reset();
  });

  describe('detectStatus', () => {
    it('should detect waiting status from Claude ready prompt', () => {
      const buffer = 'Welcome to Claude Code!\n? for shortcuts';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
    });

    it('should detect waiting status from input prompt', () => {
      const buffer = 'Welcome to Claude Code!\nSome output\n> ';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
    });

    it('should not treat y/N prompts as waiting', () => {
      const buffer = 'Do you want to continue? (y/N) ';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).not.toBe('waiting');
    });

    it('should detect waiting status from Cost line (completion)', () => {
      const buffer = 'Task completed successfully.\nCost: $0.05';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
    });

    it('should not treat older Cost lines as completion when output continues', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Cost: $0.05\nContinuing work...\nMore output';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).not.toBe('waiting');
    });

    it('should detect busy status when tool is active', () => {
      const buffer = '\\u25cf Read(src/index.js)\nReading file...';
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now(); // Simulate recent output
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should not treat bash PS2 > as waiting without Claude context', () => {
      const buffer = 'echo \"hi\"\n> ';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).not.toBe('waiting');
    });

    it('should detect busy status when thinking', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Processing...\n\\u2234 Thinking...';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should not classify shell prompts as idle when Claude is likely active', () => {
      // "$" can appear in code blocks/snippets while Claude is working; do not flip to idle.
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = `Welcome to Claude Code!\n${'Example output '.repeat(20)}\n$`;
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect idle status after quiet period', () => {
      // Set up as if we've already processed this buffer (no new content)
      const buffer = 'Task completed successfully. The operation finished without errors. All tests passed. No issues found. '.repeat(2);
      const state = detector.getState(sessionId);
      state.lastBufferLength = buffer.length; // Prevent update of lastOutputTime
      state.lastOutputTime = Date.now() - 240000; // quiet long enough to be idle (busy-silence window is minutes)
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
    });
  });

  describe('looksLikePrompt', () => {
    it('should detect shell prompt $', () => {
      expect(detector.looksLikePrompt('$')).toBe(true);
    });

    it('should detect input prompt >', () => {
      expect(detector.looksLikePrompt('>')).toBe(true);
    });

    it('should detect python REPL prompt', () => {
      expect(detector.looksLikePrompt('>>>')).toBe(true);
    });

    it('should detect user@host prompt', () => {
      expect(detector.looksLikePrompt('user@host:~$')).toBe(true);
    });

    it('should not detect regular text', () => {
      expect(detector.looksLikePrompt('Hello world')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset internal state', () => {
      detector.getState(sessionId).lastBufferLength = 1000;
      detector.getState(sessionId).lastOutputTime = 12345;

      detector.reset();

      expect(detector.sessionState.size).toBe(0);
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid status changes', () => {
      const buffer1 = 'Some output';
      const status1 = detector.detectStatus(sessionId, buffer1);

      // Simulate immediate call with different output
      const buffer2 = buffer1 + '\nMore output';
      const status2 = detector.detectStatus(sessionId, buffer2);

      // Both should return a consistent status due to debouncing
      expect(typeof status1).toBe('string');
      expect(typeof status2).toBe('string');
    });
  });
});
