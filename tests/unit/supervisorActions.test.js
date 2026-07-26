const {
  classifyPermissionPrompt,
  parseResetTime,
  buildProblemBrief,
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
  advice: 'nothing for 15 minutes',
  quietSeconds: 900,
  status: 'busy',
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

describe('permission classification', () => {
  test('approves an unambiguously safe prompt', () => {
    expect(classifyPermissionPrompt('Do you want to proceed? Read(src/index.js)', rules.safety).safe).toBe(true);
    expect(classifyPermissionPrompt('Bash(npm run test)', rules.safety).safe).toBe(true);
  });

  test('a deny pattern beats an allow pattern in the same prompt', () => {
    const verdict = classifyPermissionPrompt('Read(x) then Bash(rm -rf build)', rules.safety);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toMatch(/deny pattern/);
  });

  test('refuses anything it does not recognize rather than guessing', () => {
    const verdict = classifyPermissionPrompt('Do you want to proceed? SomeNewTool(x)', rules.safety);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toMatch(/no allow pattern/);
  });

  test('refuses to touch credentials or force-push', () => {
    expect(classifyPermissionPrompt('Read(~/.ssh/id_rsa)', rules.safety).safe).toBe(false);
    expect(classifyPermissionPrompt('Read(.env)', rules.safety).safe).toBe(false);
    expect(classifyPermissionPrompt('Bash(git push --force origin main)', rules.safety).safe).toBe(false);
    expect(classifyPermissionPrompt('Bash(gh pr merge 12)', rules.safety).safe).toBe(false);
  });

  test('ordinary edits and commits are allowed — this has to be usable', () => {
    expect(classifyPermissionPrompt('Edit(src/app.js)', rules.safety).safe).toBe(true);
    expect(classifyPermissionPrompt('Write(src/components/Button.tsx)', rules.safety).safe).toBe(true);
    expect(classifyPermissionPrompt('Edit(docs/README.md)', rules.safety).safe).toBe(true);
    expect(classifyPermissionPrompt('Bash(git commit -m "fix")', rules.safety).safe).toBe(true);
  });

  test('refuses to auto-approve writes that execute on the next ordinary operation', () => {
    // Each of these, once auto-approved, runs code via an already-allowlisted
    // `npm run build` / `git commit` — so they must fail closed to a human.
    for (const prompt of [
      'Edit(.git/hooks/post-commit)',
      'Write(package.json)',
      'Edit(package-lock.json)',
      'Write(.github/workflows/ci.yml)',
      'Edit(Makefile)',
      'Write(~/.bashrc)',
      'Edit(~/.npmrc)',
      'Write(/etc/passwd)',
      'Edit(pyproject.toml)'
    ]) {
      const verdict = classifyPermissionPrompt(prompt, rules.safety);
      expect(verdict.safe).toBe(false);
      expect(verdict.reason).toMatch(/deny pattern/);
    }
  });

  test('an empty prompt is not safe', () => {
    expect(classifyPermissionPrompt('', rules.safety).safe).toBe(false);
  });
});

describe('parseResetTime', () => {
  const now = new Date('2026-07-26T14:00:00');

  test('reads the reset hour out of a limit banner', () => {
    expect(parseResetTime('5-hour limit reached ∙ resets 3pm', now).getHours()).toBe(15);
    expect(parseResetTime('limit reached ∙ resets 9:30pm', now).getMinutes()).toBe(30);
  });

  test('a reset time already past today means tomorrow', () => {
    const reset = parseResetTime('resets 3am', now);
    expect(reset.getDate()).toBe(now.getDate() + 1);
  });

  test('returns null when there is no time to parse', () => {
    expect(parseResetTime('something else entirely', now)).toBeNull();
  });
});

describe('problem brief', () => {
  test('gives the Commander enough to act without asking the human', () => {
    const brief = buildProblemBrief(
      finding({ branch: 'feature/x', tier: 1, ticketTitle: 'Fix physics' }),
      { tail: 'line one\nline two' }
    );
    expect(brief).toMatch(/Busy but silent on work1/);
    expect(brief).toMatch(/Branch: feature\/x/);
    expect(brief).toMatch(/Tier: T1/);
    expect(brief).toMatch(/line two/);
    expect(brief).toMatch(/Diagnose and fix it yourself/);
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
    expect(await submitText({ writeToSession: () => false }, 'x', 'hi', { delayMs: 1 })).toBe(false);
  });
});

describe('executor', () => {
  const run = (extra = {}) => createExecutor({ activityFeed: { track: () => {} }, ...extra });

  test('observe does nothing outward', async () => {
    const sessionManager = fakeSessionManager();
    const result = await run({ sessionManager })({
      finding: finding(),
      plan: { intent: 'observe', reason: 'informational' },
      signal: {},
      rules
    });
    expect(result.outcome).toBe('observed');
    expect(sessionManager.writes).toEqual([]);
  });

  test('resolving a stall types the instruction into the session', async () => {
    const sessionManager = fakeSessionManager();
    const result = await run({ sessionManager })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'nudge', text: 'status?' },
      signal: {},
      rules
    });
    expect(result.outcome).toBe('resolved');
    expect(sessionManager.writes.map((w) => w.data)).toEqual(['status?', '\r']);
  });

  test('a handler outside allowedHandlers is blocked', async () => {
    const sessionManager = fakeSessionManager();
    const result = await run({ sessionManager })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'delete-everything' },
      signal: {},
      rules
    });
    expect(result.outcome).toBe('blocked');
    expect(sessionManager.writes).toEqual([]);
  });

  test('a risky permission prompt is escalated, never approved', async () => {
    const sessionManager = fakeSessionManager();
    const result = await run({ sessionManager })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'answer-permission' },
      signal: { tail: 'Do you want to proceed? Bash(sudo rm -rf /)' },
      rules
    });
    expect(result.outcome).toBe('repair-failed');
    expect(result.escalate).toBe(true);
    expect(sessionManager.writes).toEqual([]);
  });

  test('a safe permission prompt is approved without anyone being told', async () => {
    const sessionManager = fakeSessionManager();
    const result = await run({ sessionManager })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'answer-permission' },
      signal: { tail: 'Do you want to proceed? Read(src/app.js)' },
      rules
    });
    expect(result.outcome).toBe('resolved');
    expect(sessionManager.writes.map((w) => w.data)).toEqual(['1', '\r']);
  });

  test('a usage limit schedules its own resume instead of reporting', async () => {
    const scheduled = [];
    const result = await run({
      sessionManager: fakeSessionManager(),
      scheduleResume: (options) => scheduled.push(options)
    })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'schedule-resume' },
      signal: { tail: '5-hour limit reached ∙ resets 3pm' },
      rules
    });

    expect(result.outcome).toBe('resolved');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].sessionId).toBe('work1-claude');
  });

  test('delegation hands a written brief to the Commander', async () => {
    const briefs = [];
    const result = await run({
      sessionManager: fakeSessionManager(),
      commanderSender: async (text) => { briefs.push(text); return true; }
    })({
      finding: finding({ label: 'Repeating the same error' }),
      plan: { intent: 'delegate', handler: 'delegate-to-commander' },
      signal: { tail: 'Error: boom\nError: boom' },
      rules
    });

    expect(result.outcome).toBe('delegated');
    expect(briefs[0]).toMatch(/Repeating the same error/);
  });

  test('with no Commander, delegation escalates rather than silently dropping', async () => {
    const result = await run({ sessionManager: fakeSessionManager() })({
      finding: finding(),
      plan: { intent: 'delegate', handler: 'delegate-to-commander' },
      signal: {},
      rules
    });
    expect(result.outcome).toBe('repair-failed');
    expect(result.escalate).toBe(true);
  });

  test('a broken activity feed does not stop the repair', async () => {
    const sessionManager = fakeSessionManager();
    const result = await createExecutor({
      sessionManager,
      activityFeed: { track: () => { throw new Error('feed down'); } },
      logger: { warn: () => {}, error: () => {} }
    })({
      finding: finding(),
      plan: { intent: 'resolve', handler: 'nudge', text: 'ping' },
      signal: {},
      rules
    });
    expect(result.outcome).toBe('resolved');
  });
});
