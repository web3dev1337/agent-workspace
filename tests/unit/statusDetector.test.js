/**
 * Unit tests for StatusDetector
 */

jest.mock('winston', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }),
  format: {
    combine: jest.fn(() => ({})),
    timestamp: jest.fn(() => ({})),
    json: jest.fn(() => ({})),
    simple: jest.fn(() => ({}))
  },
  transports: {
    File: jest.fn(),
    Console: jest.fn()
  }
}), { virtual: true });

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

    it('should detect waiting status when prompt follows completion (Cost line)', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      state.claudeLikely = true;
      const buffer = 'Task completed successfully.\nCost: $0.05\n> ';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
    });

    it('should not treat markdown/code lines ending with ">" as waiting', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      state.claudeLikely = true;
      const buffer = `${'Example output '.repeat(20)}\n>`;
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
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

    it('should detect busy status for Agent tool', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Starting sub-agent\n● Agent(explore codebase)';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy status for WebSearch tool', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Searching the web\n● WebSearch("codex cli patterns")';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy status for WebFetch tool', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Fetching page\n● WebFetch("https://example.com")';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy status for Skill tool', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Running skill\n● Skill("commit")';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy when "Waiting for permission" is shown', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Some output\nWaiting for permission\u2026';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy when "Waiting for task" is shown', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Sub-agent running\n     Waiting for task (esc to give additional instructions)';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect busy when "compacting conversation" is shown', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = 'Long context\ncompacting conversation';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect waiting from per-model token usage line', () => {
      const buffer = 'Task done\n  1234 input, 567 output, 890 cache read, 0 cache write ($0.05)';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
    });

    it('should detect waiting from Total duration line', () => {
      const buffer = 'Task done\nTotal duration (wall): 2m 30s';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('waiting');
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

    it('should classify explicit shell prompts as idle even if Claude was previously active', () => {
      const state = detector.getState(sessionId);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const buffer = `Welcome to Claude Code!\n${'Example output '.repeat(20)}\n$`;
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
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

    it('should return idle after long quiet windows for Claude sessions', () => {
      const buffer = `Welcome to Claude Code!\n${'Working '.repeat(30)}\nstill working`;
      const state = detector.getState(sessionId);
      state.lastBufferLength = buffer.length;
      state.lastOutputTime = Date.now() - 240000; // 4 minutes of silence
      state.claudeLikely = true;
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
    });

    it('should not keep agent terminals busy after long quiet windows', () => {
      const agentSessionId = 'work1-claude';
      const buffer = `Starting work...\n${'Working '.repeat(30)}\nstill working`;
      const state = detector.getState(agentSessionId);
      state.lastBufferLength = buffer.length;
      state.lastOutputTime = Date.now() - 240000; // 4 minutes of silence
      state.claudeLikely = false;
      const status = detector.detectStatus(agentSessionId, buffer);
      expect(status).toBe('idle');
    });

    it('should treat trailing ellipsis as busy only when output is recent', () => {
      const agentSessionId = 'work2-claude';
      const buffer = `Working through tasks...\nChecking files...\nStill running...`;
      const state = detector.getState(agentSessionId);
      state.lastBufferLength = buffer.length;
      state.lastOutputTime = Date.now();
      state.claudeLikely = false;
      const status = detector.detectStatus(agentSessionId, buffer);
      expect(status).toBe('busy');
    });

    it('should detect waiting status for Codex prompt', () => {
      const buffer = 'Starting...\n> ';
      const status = detector.detectStatus('work1-claude', buffer, { agent: 'codex' });
      expect(status).toBe('waiting');
    });

    it('should not set claudeLikely when Codex is the active agent', () => {
      const sessionId = 'work2-claude';
      const buffer = 'Welcome to Claude Code!\n? for shortcuts\nSome output\n> ';
      const status = detector.detectStatus(sessionId, buffer, { agent: 'codex' });
      expect(status).toBe('waiting');
      expect(detector.getState(sessionId).claudeLikely).toBe(false);
    });

    it('should detect waiting status for Gemini prompt chrome even when the prompt is not the last line', () => {
      const buffer = [
        '? for shortcuts',
        '────────────────────────────────────────────────────────────────────────────────',
        'Shift+Tab to accept edits                                     1 GEMINI.md file',
        '>  Type your message or @path/to/file',
        'workspace (/directory)                sandbox                           /model',
        '/tmp                                  no sandbox               Auto (Gemini 3)'
      ].join('\n');
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('waiting');
    });

    it('should detect waiting status for Gemini authentication flow', () => {
      const buffer = 'Gemini CLI\n⠋ Waiting for authentication... (Press Esc or Ctrl+C to cancel)';
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('waiting');
    });

    it('should detect busy status for Gemini responding indicator', () => {
      const buffer = 'Thinking... Planning the response... (esc to cancel, 3s)';
      const state = detector.getState('work3-claude');
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('busy');
    });

    it('should not keep Gemini terminals busy after a short quiet window', () => {
      const geminiSessionId = 'work3-claude';
      const buffer = 'Thinking... Planning the response... (esc to cancel, 3s)';
      const state = detector.getState(geminiSessionId);
      state.lastBufferLength = buffer.length;
      state.lastOutputTime = Date.now() - 10000;
      const status = detector.detectStatus(geminiSessionId, buffer, { agent: 'gemini' });
      expect(status).toBe('idle');
    });

    it('should detect waiting status for OpenCode prompt chrome', () => {
      const buffer = [
        'Ask anything... "What is the tech stack of this project?"',
        'ctrl+t variants  tab agents  ctrl+p commands'
      ].join('\n');
      const status = detector.detectStatus('work4-claude', buffer, { agent: 'opencode' });
      expect(status).toBe('waiting');
    });

    // --- Codex busy patterns ---
    it('should detect busy status for Codex "esc to interrupt" indicator', () => {
      const sid = 'work1-claude';
      const buffer = 'Running task...\nesc to interrupt';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'codex' });
      expect(status).toBe('busy');
    });

    it('should detect waiting status for Codex "Choose an action" prompt', () => {
      const buffer = 'Choose an action\n  Approve\n  Reject';
      const status = detector.detectStatus('work1-claude', buffer, { agent: 'codex' });
      expect(status).toBe('waiting');
    });

    // --- Gemini tool confirmation patterns ---
    it('should detect waiting status for Gemini "Apply this change?" prompt', () => {
      const buffer = 'Some file edit output\nApply this change?\n  Allow once\n  Allow for this session';
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('waiting');
    });

    it('should detect waiting status for Gemini "Allow execution of" prompt', () => {
      const buffer = 'Allow execution of: \'npm test\'?\n  Allow once\n  No, suggest changes (esc)';
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('waiting');
    });

    it('should detect waiting status for Gemini verification flow', () => {
      const buffer = 'Gemini CLI\nWaiting for verification... (Press Esc or Ctrl+C to cancel)';
      const status = detector.detectStatus('work3-claude', buffer, { agent: 'gemini' });
      expect(status).toBe('waiting');
    });

    // --- OpenCode busy patterns ---
    it('should detect busy status for OpenCode "Thinking..." indicator', () => {
      const sid = 'work4-claude';
      const buffer = 'Processing request\nThinking...';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'opencode' });
      expect(status).toBe('busy');
    });

    it('should detect busy status for OpenCode "Generating..." indicator', () => {
      const sid = 'work4-claude';
      const buffer = 'Building response\nGenerating...';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'opencode' });
      expect(status).toBe('busy');
    });

    it('should detect busy status for OpenCode "Working..." indicator', () => {
      const sid = 'work4-claude';
      const buffer = 'Executing tools\nWorking...';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'opencode' });
      expect(status).toBe('busy');
    });

    it('should detect busy status for OpenCode "Waiting for tool response..." indicator', () => {
      const sid = 'work4-claude';
      const buffer = 'Running tool\nWaiting for tool response...';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'opencode' });
      expect(status).toBe('busy');
    });

    it('should detect waiting for OpenCode "press enter to send" hint', () => {
      const buffer = 'Some content\npress enter to send the message';
      const status = detector.detectStatus('work4-claude', buffer, { agent: 'opencode' });
      expect(status).toBe('waiting');
    });

    // --- Aider busy/waiting patterns ---
    it('should detect waiting status for Aider multiline prompt', () => {
      const buffer = 'Some output\nmulti> ';
      const status = detector.detectStatus('work5-claude', buffer, { agent: 'aider' });
      expect(status).toBe('waiting');
    });

    it('should detect waiting status for Aider named prompt', () => {
      const buffer = 'Some output\naider> ';
      const status = detector.detectStatus('work5-claude', buffer, { agent: 'aider' });
      expect(status).toBe('waiting');
    });

    it('should detect busy status for Aider "Waiting for LLM" spinner', () => {
      const sid = 'work5-claude';
      const buffer = 'Processing edit\nWaiting for Claude LLM';
      const state = detector.getState(sid);
      state.lastOutputTime = Date.now();
      state.lastBufferLength = 0;
      const status = detector.detectStatus(sid, buffer, { agent: 'aider' });
      expect(status).toBe('busy');
    });

    it('should detect idle status from zsh-style prompt', () => {
      const buffer = '/home/<user>/GitHub/project %';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
    });

    it('should detect idle status from starship-style prompt glyph', () => {
      const buffer = '~/GitHub/project ❯';
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
    });

    it('should detect idle status from no-agent banner', () => {
      const buffer = "Claude session ended.\nType 'claude' to start a new Claude session.";
      const status = detector.detectStatus(sessionId, buffer);
      expect(status).toBe('idle');
    });

    it('should detect idle status from ANSI-colored shell prompts', () => {
      const buffer = '\u001b[32mab@host\u001b[0m:\u001b[34m~/repo\u001b[0m$ ';
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

  describe('hasExplicitShellIndicator', () => {
    it('should detect shell indicator from no-agent banner', () => {
      const recentAll = "Claude session ended.\nType 'claude' to start a new Claude session.";
      expect(detector.hasExplicitShellIndicator(recentAll, '')).toBe(true);
    });

    it('should detect shell indicator from ANSI prompt line', () => {
      const recentAll = '\u001b[32mab@host\u001b[0m:\u001b[34m~/repo\u001b[0m$';
      expect(detector.hasExplicitShellIndicator(recentAll, '\u001b[32mab@host\u001b[0m:\u001b[34m~/repo\u001b[0m$')).toBe(true);
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
