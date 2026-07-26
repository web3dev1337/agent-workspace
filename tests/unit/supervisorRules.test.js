const {
  loadRules,
  normalizeCondition,
  matches,
  planAction,
  capabilities,
  evaluate,
  DEFAULT_RULES_PATH
} = require('../../server/supervisor/supervisorRules');

const rulesFor = (overrides = {}) => ({ ...loadRules({ rulesPath: DEFAULT_RULES_PATH }), ...overrides });

const signal = (overrides = {}) => ({
  sessionId: 'zoo-game-work1-claude',
  type: 'claude',
  status: 'idle',
  agent: 'claude',
  agentPresent: true,
  worktreeId: 'work1',
  quietSeconds: 0,
  tail: '',
  lastLine: '',
  repeatedLineCount: 1,
  git: null,
  tier: 3,
  ...overrides
});

describe('supervisorRules', () => {
  test('the shipped table defaults to acting, not narrating', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    expect(rules.autonomy).toBe('autopilot');
    expect(rules.conditions.length).toBeGreaterThan(0);
  });

  test('every shipped condition knows how to fix itself', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    for (const condition of rules.conditions) {
      expect(condition.resolve).not.toBeNull();
      expect(rules.safety.allowedHandlers.concat('observe')).toContain(condition.resolve.handler);
    }
  });

  test('SUPERVISOR_AUTONOMY overrides the config file', () => {
    process.env.SUPERVISOR_AUTONOMY = 'observe';
    try {
      expect(loadRules({ rulesPath: DEFAULT_RULES_PATH }).autonomy).toBe('observe');
    } finally {
      delete process.env.SUPERVISOR_AUTONOMY;
    }
  });

  test('a malformed regex in config does not break rule loading', () => {
    const condition = normalizeCondition({ id: 'x', when: { tailMatches: ['(unclosed', 'fine'] } });
    expect(condition.when.tailMatches).toHaveLength(1);
  });

  test('quiet-time thresholds gate a condition', () => {
    const condition = normalizeCondition({ id: 'stalled', when: { status: ['busy'], minQuietSeconds: 600 } });
    expect(matches(condition, signal({ status: 'busy', quietSeconds: 300 }))).toBe(false);
    expect(matches(condition, signal({ status: 'busy', quietSeconds: 900 }))).toBe(true);
  });

  test('tailNotMatches vetoes an otherwise matching condition', () => {
    const condition = normalizeCondition({
      id: 'stalled',
      when: { status: ['busy'], tailNotMatches: ['limit reached'] }
    });
    expect(matches(condition, signal({ status: 'busy', tail: 'working…' }))).toBe(true);
    expect(matches(condition, signal({ status: 'busy', tail: '5-hour limit reached ∙ resets 3am' }))).toBe(false);
  });

  test('a git-dependent condition cannot fire without a git read', () => {
    const condition = normalizeCondition({ id: 'unpushed', when: { git: { aheadMin: 1 } } });
    expect(matches(condition, signal({ git: null }))).toBe(false);
    expect(matches(condition, signal({ git: { ahead: 2, dirty: false } }))).toBe(true);
    expect(matches(condition, signal({ git: { ahead: 0, dirty: false } }))).toBe(false);
  });

  describe('planAction — fix first, interrupt last', () => {
    const condition = normalizeCondition({
      id: 'stalled',
      escalateAfterAttempts: 2,
      resolve: { handler: 'nudge', text: 'status?' }
    });

    test('the first response to a problem is to fix it', () => {
      const plan = planAction(condition, { autonomy: 'autopilot', attempts: 0 });
      expect(plan.intent).toBe('resolve');
      expect(plan.handler).toBe('nudge');
    });

    test('a human is only considered once repair attempts are exhausted', () => {
      expect(planAction(condition, { autonomy: 'autopilot', attempts: 1 }).intent).toBe('resolve');
      expect(planAction(condition, { autonomy: 'autopilot', attempts: 2 }).intent).toBe('interrupt');
    });

    test('delegation to the Commander needs autopilot', () => {
      const delegating = normalizeCondition({ id: 'loop', resolve: { handler: 'delegate-to-commander' } });
      expect(planAction(delegating, { autonomy: 'autopilot', attempts: 0 }).intent).toBe('delegate');
      expect(planAction(delegating, { autonomy: 'assist', attempts: 0 }).intent).toBe('observe');
    });

    test('observe watches without acting; off does nothing at all', () => {
      expect(planAction(condition, { autonomy: 'observe', attempts: 0 }).intent).toBe('observe');
      expect(planAction(condition, { autonomy: 'off', attempts: 0 }).intent).toBe('none');
    });

    test('a purely informational condition never escalates', () => {
      const informational = normalizeCondition({ id: 'idle', resolve: { handler: 'observe' } });
      expect(planAction(informational, { autonomy: 'autopilot', attempts: 99 }).intent).toBe('observe');
    });

    test('a condition with no fix available goes straight to a human', () => {
      const unfixable = normalizeCondition({ id: 'x', escalateAfterAttempts: 0 });
      expect(planAction(unfixable, { autonomy: 'autopilot', attempts: 0 }).intent).toBe('interrupt');
    });
  });

  test('autonomy capabilities map to what may be done, not what may be said', () => {
    expect(capabilities('observe')).toEqual({ resolve: false, delegate: false });
    expect(capabilities('assist')).toEqual({ resolve: true, delegate: false });
    expect(capabilities('autopilot')).toEqual({ resolve: true, delegate: true });
  });

  test('autonomy "off" produces no findings at all', () => {
    expect(evaluate([signal({ status: 'busy', quietSeconds: 5000 })], rulesFor({ autonomy: 'off' }))).toEqual([]);
  });

  test('only the first matching condition fires per session', () => {
    const findings = evaluate([signal({
      status: 'busy',
      quietSeconds: 5000,
      tail: 'Claude usage limit reached ∙ resets 3am'
    })], rulesFor());

    expect(findings).toHaveLength(1);
    expect(findings[0].conditionId).toBe('usage-limit-reached');
  });

  test('a usage limit is treated as a wait, not an emergency', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const limit = rules.conditions.find((c) => c.id === 'usage-limit-reached');
    expect(limit.severity).toBe('info');
    expect(limit.resolve.handler).toBe('schedule-resume');
    expect(limit.escalateAfterAttempts).toBeGreaterThan(10);
  });

  test('findings carry a stable id so attempts and cooldowns can key on them', () => {
    const [finding] = evaluate([signal({ status: 'busy', quietSeconds: 1200 })], rulesFor());
    expect(finding.id).toBe('zoo-game-work1-claude:stalled');
  });

  test('an exited agent is detected from the recovery marker, not the tail', () => {
    const findings = evaluate([signal({ status: 'idle', agentPresent: false, quietSeconds: 600 })], rulesFor());
    expect(findings[0].conditionId).toBe('agent-exited');
  });
});
