const {
  classifyPermissionPrompt,
  submitText,
  createExecutor
} = require('../../server/supervisor/supervisorActions');
const { loadRules, DEFAULT_RULES_PATH } = require('../../server/supervisor/supervisorRules');

const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });

const finding = (overrides = {}) => ({
  id: 'work1-claude:stalled',
  conditionId: 'stalled',
  label: 'Busy but silent',
  severity: 'warn',
  sessionId: 'work1-claude',
  worktreeId: 'work1',
  rung: 'notify',
  requestedRung: 'notify',
  advice: 'nothing for 15 minutes',
  nudgeText: '',
  actHandler: '',
  ...overrides
});

function fakeSessionManager() {
  const writes = [];
  return {
    writes,
    writeToSession(sessionId, data) {
      writes.push({ sessionId, data });
      return true;
    }
  };
}

describe('supervisorActions', () => {
  describe('permission classification', () => {
    test('approves an unambiguously read-only prompt', () => {
      const verdict = classifyPermissionPrompt('Do you want to proceed? Read(src/index.js)', rules.safety);
      expect(verdict.safe).toBe(true);
    });

    test('refuses anything matching a deny pattern, even alongside an allow match', () => {
      const verdict = classifyPermissionPrompt('Read(x) then Bash(rm -rf build)', rules.safety);
      expect(verdict.safe).toBe(false);
      expect(verdict.reason).toMatch(/deny pattern/);
    });

    test('refuses a prompt it does not recognize rather than guessing', () => {
      const verdict = classifyPermissionPrompt('Do you want to proceed? SomeNewTool(x)', rules.safety);
      expect(verdict.safe).toBe(false);
      expect(verdict.reason).toMatch(/no allow pattern/);
    });

    test('refuses git push even though other git commands are allowed', () => {
      expect(classifyPermissionPrompt('Bash(git push origin main)', rules.safety).safe).toBe(false);
      expect(classifyPermissionPrompt('Bash(git status)', rules.safety).safe).toBe(true);
    });

    test('an empty prompt is not safe', () => {
      expect(classifyPermissionPrompt('', rules.safety).safe).toBe(false);
    });
  });

  describe('submitText', () => {
    test('writes the text and the Enter separately', async () => {
      const sessionManager = fakeSessionManager();
      await submitText(sessionManager, 'work1-claude', 'status?', { delayMs: 1 });
      expect(sessionManager.writes).toEqual([
        { sessionId: 'work1-claude', data: 'status?' },
        { sessionId: 'work1-claude', data: '\r' }
      ]);
    });

    test('does not send Enter when the first write fails', async () => {
      const sessionManager = { writeToSession: () => false };
      expect(await submitText(sessionManager, 'x', 'hi', { delayMs: 1 })).toBe(false);
    });
  });

  describe('executor', () => {
    test('observe does nothing outward', async () => {
      const sessionManager = fakeSessionManager();
      const tracked = [];
      const execute = createExecutor({ sessionManager, activityFeed: { track: (k, d) => tracked.push([k, d]) } });

      const result = await execute({ finding: finding({ rung: 'observe' }), signal: {}, rules });
      expect(result.outcome).toBe('observed');
      expect(sessionManager.writes).toEqual([]);
      expect(tracked).toEqual([]);
    });

    test('notify records and alerts but never types', async () => {
      const sessionManager = fakeSessionManager();
      const notified = [];
      const execute = createExecutor({
        sessionManager,
        activityFeed: { track: () => {} },
        notificationService: { notify: (...args) => notified.push(args) }
      });

      const result = await execute({ finding: finding({ rung: 'notify' }), signal: {}, rules });
      expect(result.outcome).toBe('notified');
      expect(sessionManager.writes).toEqual([]);
      expect(notified).toHaveLength(1);
    });

    test('nudge types the configured text into the session', async () => {
      const sessionManager = fakeSessionManager();
      const execute = createExecutor({ sessionManager, activityFeed: { track: () => {} } });

      const result = await execute({
        finding: finding({ rung: 'nudge', nudgeText: 'status?' }),
        signal: {},
        rules
      });
      expect(result.outcome).toBe('nudged');
      expect(sessionManager.writes.map((w) => w.data)).toEqual(['status?', '\r']);
    });

    test('a handler outside allowedActHandlers is blocked', async () => {
      const sessionManager = fakeSessionManager();
      const execute = createExecutor({ sessionManager, activityFeed: { track: () => {} } });

      const result = await execute({
        finding: finding({ rung: 'act', actHandler: 'delete-everything' }),
        signal: {},
        rules
      });
      expect(result.outcome).toBe('act-blocked');
      expect(sessionManager.writes).toEqual([]);
    });

    test('auto-answering a risky permission prompt escalates instead', async () => {
      const sessionManager = fakeSessionManager();
      const execute = createExecutor({ sessionManager, activityFeed: { track: () => {} } });

      const result = await execute({
        finding: finding({ rung: 'act', actHandler: 'answer-permission' }),
        signal: { tail: 'Do you want to proceed? Bash(sudo rm -rf /)' },
        rules
      });
      expect(result.outcome).toBe('escalated');
      expect(sessionManager.writes).toEqual([]);
    });

    test('auto-answering a read-only permission prompt approves it', async () => {
      const sessionManager = fakeSessionManager();
      const execute = createExecutor({ sessionManager, activityFeed: { track: () => {} } });

      const result = await execute({
        finding: finding({ rung: 'act', actHandler: 'answer-permission' }),
        signal: { tail: 'Do you want to proceed? Read(src/app.js)' },
        rules
      });
      expect(result.outcome).toBe('acted');
      expect(sessionManager.writes.map((w) => w.data)).toEqual(['1', '\r']);
    });

    test('a broken notification channel does not stop the action', async () => {
      const sessionManager = fakeSessionManager();
      const execute = createExecutor({
        sessionManager,
        activityFeed: { track: () => { throw new Error('feed down'); } },
        notificationService: { notify: () => { throw new Error('notify down'); } },
        logger: { warn: () => {}, error: () => {} }
      });

      const result = await execute({
        finding: finding({ rung: 'nudge', nudgeText: 'ping' }),
        signal: {},
        rules
      });
      expect(result.outcome).toBe('nudged');
    });
  });
});
