const {
  scoreUrgency,
  isQuietHour,
  normalizeInterruptionPolicy,
  InterruptionBudget,
  DigestQueue
} = require('../../server/supervisor/supervisorUrgency');

const policy = normalizeInterruptionPolicy({});

const finding = (overrides = {}) => ({
  id: 'work1-claude:stalled',
  sessionId: 'work1-claude',
  worktreeId: 'work1',
  label: 'Busy but silent',
  severity: 'warn',
  advice: 'nothing for 15 minutes',
  tier: 3,
  ...overrides
});

describe('urgency scoring', () => {
  test('the same problem on background work scores far below focus work', () => {
    const background = scoreUrgency(finding({ tier: 3 }), { policy });
    const focus = scoreUrgency(finding({ tier: 1 }), { policy });

    expect(focus).toBeGreaterThan(background);
    expect(background).toBeLessThan(policy.threshold);
    expect(focus).toBeGreaterThanOrEqual(policy.threshold);
  });

  test('tier 4 is effectively never worth an interruption', () => {
    expect(scoreUrgency(finding({ tier: 4, severity: 'warn' }), { policy })).toBeLessThan(policy.threshold);
  });

  test('a critical problem on focus work outranks everything', () => {
    const score = scoreUrgency(finding({ tier: 1, severity: 'critical' }), { policy });
    expect(score).toBeGreaterThanOrEqual(policy.alwaysInterruptAbove);
  });

  test('repeated failed repairs raise urgency — resisting a fix is information', () => {
    const first = scoreUrgency(finding({ tier: 2 }), { policy, attempts: 0 });
    const fourth = scoreUrgency(finding({ tier: 2 }), { policy, attempts: 3 });
    expect(fourth).toBeGreaterThan(first);
  });

  test('a condition can pin its own base score regardless of severity', () => {
    const score = scoreUrgency(finding({ tier: 1, severity: 'critical' }), {
      policy,
      condition: { urgency: { base: 5 } }
    });
    expect(score).toBeLessThan(policy.threshold);
  });

  test('blocking work adds weight', () => {
    const plain = scoreUrgency(finding({ tier: 2 }), { policy });
    const blocking = scoreUrgency(finding({ tier: 2 }), { policy, condition: { urgency: { blocksWork: true } } });
    expect(blocking).toBeGreaterThan(plain);
  });

  test('an untiered session sits between focus and background', () => {
    const untiered = scoreUrgency(finding({ tier: null }), { policy });
    expect(untiered).toBeGreaterThan(scoreUrgency(finding({ tier: 3 }), { policy }));
    expect(untiered).toBeLessThan(scoreUrgency(finding({ tier: 1 }), { policy }));
  });
});

describe('quiet hours', () => {
  const quiet = normalizeInterruptionPolicy({ quietHours: { enabled: true, startHour: 22, endHour: 7 } });

  test('an overnight window wraps midnight correctly', () => {
    expect(isQuietHour(quiet, new Date('2026-07-26T23:30:00'))).toBe(true);
    expect(isQuietHour(quiet, new Date('2026-07-26T03:00:00'))).toBe(true);
    expect(isQuietHour(quiet, new Date('2026-07-26T12:00:00'))).toBe(false);
  });

  test('disabled quiet hours never apply', () => {
    expect(isQuietHour(policy, new Date('2026-07-26T03:00:00'))).toBe(false);
  });
});

describe('InterruptionBudget', () => {
  let now;
  const budget = () => new InterruptionBudget({ policy: { maxPerHour: 2, minSecondsBetween: 600 }, now: () => now });

  beforeEach(() => { now = Date.parse('2026-07-26T12:00:00Z'); });

  test('below-threshold findings never interrupt', () => {
    expect(budget().evaluate(30).allow).toBe(false);
  });

  test('the hourly budget stops a third interruption', () => {
    const b = budget();
    expect(b.evaluate(70).allow).toBe(true);
    b.record();
    now += 700_000;
    expect(b.evaluate(70).allow).toBe(true);
    b.record();
    now += 700_000;

    const third = b.evaluate(70);
    expect(third.allow).toBe(false);
    expect(third.reason).toMatch(/budget spent/);
  });

  test('two interruptions in quick succession are throttled', () => {
    const b = budget();
    b.record();
    now += 60_000;
    expect(b.evaluate(70).reason).toMatch(/too soon/);
  });

  test('a genuine emergency overrides both the budget and quiet hours', () => {
    const b = new InterruptionBudget({
      policy: { maxPerHour: 0, quietHours: { enabled: true, startHour: 0, endHour: 23 } },
      now: () => now
    });
    expect(b.evaluate(95).allow).toBe(true);
    expect(b.evaluate(70).allow).toBe(false);
  });

  test('the budget forgets interruptions older than an hour', () => {
    const b = budget();
    b.record();
    b.record();
    now += 3_700_000;
    expect(b.evaluate(70).allow).toBe(true);
  });
});

describe('DigestQueue', () => {
  let now;
  const queue = () => new DigestQueue({ now: () => now });

  beforeEach(() => { now = Date.parse('2026-07-26T12:00:00Z'); });

  test('repeats of the same finding collapse into one entry with a count', () => {
    const q = queue();
    q.add(finding(), { score: 40, reason: 'below threshold' });
    q.add(finding(), { score: 55, reason: 'below threshold' });

    const pending = q.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].count).toBe(2);
    expect(pending[0].score).toBe(55);
  });

  test('a finding that heals is pulled from the digest and never mentioned', () => {
    const q = queue();
    q.add(finding(), { score: 40, reason: 'below threshold' });
    expect(q.resolve('work1-claude:stalled')).toBe(true);
    expect(q.pending()).toEqual([]);
  });

  test('pending items are ordered by urgency', () => {
    const q = queue();
    q.add(finding({ id: 'a' }), { score: 20, reason: 'x' });
    q.add(finding({ id: 'b' }), { score: 55, reason: 'x' });
    expect(q.pending().map((item) => item.id)).toEqual(['b', 'a']);
  });

  test('an empty digest is never due', () => {
    const q = queue();
    q.setInterval(1);
    now += 3_600_000;
    expect(q.isDue()).toBe(false);
  });

  test('the digest becomes due once the interval passes with something waiting', () => {
    const q = queue();
    q.setInterval(60);
    q.add(finding(), { score: 20, reason: 'x' });
    expect(q.isDue()).toBe(false);
    now += 3_700_000;
    expect(q.isDue()).toBe(true);
  });

  test('draining empties the queue and resets the clock', () => {
    const q = queue();
    q.setInterval(60);
    q.add(finding(), { score: 20, reason: 'x' });
    now += 3_700_000;

    expect(q.drain()).toHaveLength(1);
    expect(q.pending()).toEqual([]);
    expect(q.isDue()).toBe(false);
  });
});

describe('null-vs-zero handling', () => {
  test('an unset urgency base falls back to severity, it does not become zero', () => {
    const explicit = scoreUrgency(finding({ tier: 1 }), { policy, condition: { urgency: { base: null } } });
    const absent = scoreUrgency(finding({ tier: 1 }), { policy, condition: {} });
    expect(explicit).toBe(absent);
    expect(explicit).toBeGreaterThan(0);
  });

  test('an explicit zero base really is zero', () => {
    expect(scoreUrgency(finding({ tier: 1 }), { policy, condition: { urgency: { base: 0 } } })).toBe(0);
  });

  test('an unset maxPerHour keeps the default rather than becoming NaN', () => {
    expect(normalizeInterruptionPolicy({}).maxPerHour).toBe(2);
    expect(normalizeInterruptionPolicy({ maxPerHour: 0 }).maxPerHour).toBe(0);
  });
});
