/**
 * Unit tests for CommanderService's Claude launch queue logic:
 * ready-prompt detection (v1/v2 banners, upgrade-notice false positive guard),
 * launch-command echo rejection, queued input flushing (trust-prompt path,
 * grace-window path, force-flush backstop), and resize skip/validation.
 */

const { CommanderService } = require('../../server/commanderService');

describe('CommanderService launch queue', () => {
  let service;
  const newline = process.platform === 'win32' ? '\r\n' : '\n';

  beforeEach(() => {
    jest.useFakeTimers();
    CommanderService.instance = null;
    service = CommanderService.getInstance({ io: null, sessionManager: null });
  });

  afterEach(() => {
    if (service.session) {
      service.stop();
    }
    CommanderService.instance = null;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  function attachSession() {
    const writes = [];
    service.session = {
      id: 'commander',
      pty: {
        write: (data) => writes.push(data),
        kill: jest.fn()
      }
    };
    service.claudeStarted = true;
    return writes;
  }

  describe('matchesClaudeReadyPrompt', () => {
    it('detects the v2 banner with mixed case and ANSI noise stripped', () => {
      const noisy = '\x1b[2J\x1b[H\x1b[1mClaude Code v2.1.201\x1b[0m\nType a message';
      expect(service.matchesClaudeReadyPrompt(service.stripControlSequences(noisy).toLowerCase())).toBe(true);
    });

    it('detects the v1 banner (Welcome to Claude Code + ? for shortcuts)', () => {
      const text = 'welcome to claude code!\n? for shortcuts';
      expect(service.matchesClaudeReadyPrompt(text)).toBe(true);
    });

    it('does not match a shell echo of the launch command', () => {
      const text = 'powershell -noexit -command "claude --dangerously-skip-permissions"';
      expect(service.matchesClaudeReadyPrompt(text)).toBe(false);
    });

    it('does not match a bash echo of the launch command', () => {
      const text = '$ claude --dangerously-skip-permissions';
      expect(service.matchesClaudeReadyPrompt(text)).toBe(false);
    });

    it('does not match an upgrade notice using an ASCII arrow', () => {
      const text = 'claude code v2.1.201 -> v2.1.205';
      expect(service.matchesClaudeReadyPrompt(text)).toBe(false);
    });

    it('does not match an upgrade notice using a unicode arrow', () => {
      const text = 'claude code v2.1.201 → v2.1.205';
      expect(service.matchesClaudeReadyPrompt(text)).toBe(false);
    });
  });

  describe('queued inputs flush after v2 banner + grace window (no trust prompt)', () => {
    it('preserves input order and flushes ~2s after the banner', () => {
      const writes = attachSession();
      service.beginClaudeLaunch({ expectTrustPrompt: true });

      expect(service.sendInput('first\n')).toBe(true);
      expect(service.sendInput('second\n')).toBe(true);
      expect(writes).toEqual([]);

      service.handleClaudeLaunchOutput('Claude Code v2.1.201\nType a message');
      expect(writes).toEqual([]); // not flushed yet - waiting on grace window

      jest.advanceTimersByTime(1999);
      expect(writes).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(writes).toEqual([`first${newline}`, `second${newline}`]);
      expect(service.claudeLaunchState).toBeNull();
    });
  });

  describe('trust-prompt path preempts the grace timer', () => {
    it('auto-accepts trust prompt and flushes once without double flush', () => {
      const writes = attachSession();
      service.beginClaudeLaunch({ expectTrustPrompt: true });

      expect(service.sendInput('queued command\n')).toBe(true);

      // Banner appears first (starts the grace timer)...
      service.handleClaudeLaunchOutput('Claude Code v2.1.201\nType a message');
      expect(writes).toEqual([]);

      // ...then the trust prompt shows up before the grace window elapses.
      service.handleClaudeLaunchOutput(
        'Quick safety check: Is this a project you created or one you trust?\n1. I trust this folder'
      );
      expect(writes).toEqual(['1\r']);

      // Advance past where the original 2s grace timer would have fired.
      jest.advanceTimersByTime(2000);
      // Trust-prompt flow uses its own 1200ms timer from the trust prompt output.
      expect(writes).toEqual(['1\r', `queued command${newline}`]);

      // Advance further to make sure nothing double-flushes.
      jest.advanceTimersByTime(20000);
      expect(writes).toEqual(['1\r', `queued command${newline}`]);
    });
  });

  describe('force-flush backstop', () => {
    it('flushes queued input after 15s even if no banner ever appears', () => {
      const writes = attachSession();
      service.beginClaudeLaunch({ expectTrustPrompt: true });

      expect(service.sendInput('stuck command\n')).toBe(true);
      expect(writes).toEqual([]);

      jest.advanceTimersByTime(14999);
      expect(writes).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(writes).toEqual([`stuck command${newline}`]);
      expect(service.claudeLaunchState).toBeNull();
    });
  });

  describe('resize', () => {
    beforeEach(() => {
      attachSession();
    });

    it('skips duplicate same-size resizes', () => {
      const resize = jest.fn();
      service.session.pty.resize = resize;

      expect(service.resize(120, 40)).toBe(true);
      expect(resize).toHaveBeenCalledTimes(1);

      expect(service.resize(120, 40)).toBe(true);
      expect(resize).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid dimensions', () => {
      const resize = jest.fn();
      service.session.pty.resize = resize;

      expect(service.resize(0, 40)).toBe(false);
      expect(service.resize(-1, 40)).toBe(false);
      expect(service.resize(1.5, 40)).toBe(false);
      expect(service.resize(NaN, 40)).toBe(false);
      expect(service.resize('abc', 40)).toBe(false);
      expect(resize).not.toHaveBeenCalled();
    });

    it('resets lastSize when a new session starts', () => {
      const resize = jest.fn();
      service.session.pty.resize = resize;

      expect(service.resize(120, 40)).toBe(true);
      expect(resize).toHaveBeenCalledTimes(1);

      // Simulate a new session (e.g. after restart) with no lastSize yet.
      attachSession();
      service.session.pty.resize = resize;

      expect(service.resize(120, 40)).toBe(true);
      expect(resize).toHaveBeenCalledTimes(2);
    });
  });
});
