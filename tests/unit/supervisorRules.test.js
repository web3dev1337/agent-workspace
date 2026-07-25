const {
  loadRules,
  normalizeCondition,
  matches,
  effectiveRung,
  evaluate,
  DEFAULT_RULES_PATH
} = require('../../server/supervisor/supervisorRules');

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
  test('the shipped rule table loads and grants no autonomy by default', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    expect(rules.autonomy).toBe('observe');
    expect(rules.conditions.length).toBeGreaterThan(0);
    expect(rules.conditions.every((c) => ['observe', 'notify', 'nudge', 'act'].includes(c.rung))).toBe(true);
  });

  test('no shipped condition asks to act — defaults never touch a terminal', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    expect(rules.conditions.some((c) => c.rung === 'act')).toBe(false);
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

  test('autonomy caps how far a condition may climb', () => {
    expect(effectiveRung('act', 'off')).toBeNull();
    expect(effectiveRung('act', 'observe')).toBe('observe');
    expect(effectiveRung('act', 'assist')).toBe('nudge');
    expect(effectiveRung('act', 'autopilot')).toBe('act');
    expect(effectiveRung('notify', 'autopilot')).toBe('notify');
  });

  test('autonomy "off" produces no findings at all', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    rules.autonomy = 'off';
    expect(evaluate([signal({ status: 'busy', quietSeconds: 5000 })], rules)).toEqual([]);
  });

  test('only the first matching condition fires per session', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const findings = evaluate([signal({
      status: 'busy',
      quietSeconds: 5000,
      tail: 'Claude usage limit reached ∙ resets 3am'
    })], rules);

    expect(findings).toHaveLength(1);
    expect(findings[0].conditionId).toBe('usage-limit-reached');
    expect(findings[0].severity).toBe('critical');
  });

  test('a stalled session is reported as stalled, not as a usage limit', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const findings = evaluate([signal({ status: 'busy', quietSeconds: 1200, tail: 'still thinking' })], rules);
    expect(findings[0].conditionId).toBe('stalled');
    expect(findings[0].requestedRung).toBe('nudge');
    expect(findings[0].rung).toBe('observe');
    expect(findings[0].suppressedByAutonomy).toBe(true);
  });

  test('findings carry a stable id so cooldowns can key on them', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const [finding] = evaluate([signal({ status: 'busy', quietSeconds: 1200 })], rules);
    expect(finding.id).toBe('zoo-game-work1-claude:stalled');
  });

  test('an exited agent is detected from the recovery marker, not the tail', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const findings = evaluate([signal({ status: 'idle', agentPresent: false, quietSeconds: 600 })], rules);
    expect(findings[0].conditionId).toBe('agent-exited');
  });
});
