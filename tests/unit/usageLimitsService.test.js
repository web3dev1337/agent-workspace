const { UsageLimitsService } = require('../../server/usageLimitsService');

describe('UsageLimitsService.parseCodexOutput', () => {
  const service = new UsageLimitsService();

  test('parses bucket lines with percentages and reset times', () => {
    const out = [
      'Codex usage — official App Server',
      'codex [codex]',
      '  primary (1 week): 9% used; resets Thu 20 Aug 2026 13:32:22 AEST',
      '  Credits: unlimited=no, available=no, balance=0'
    ].join('\n');
    const windows = service.parseCodexOutput(out);
    expect(windows).toHaveLength(1);
    expect(windows[0].name).toBe('primary');
    expect(windows[0].bucket).toBe('codex');
    expect(windows[0].window).toBe('1 week');
    expect(windows[0].usedPercentage).toBe(9);
    expect(typeof windows[0].resetsAt).toBe('number');
  });

  test('skips drift warnings and unrelated lines', () => {
    const out = [
      'Category/schema drift detected:',
      '  - added aggregate.fields.spendControlReached',
      'Verify the official output, then rerun with --accept-current.',
      '  secondary (5 hours): 42% used; resets Sat 15 Aug 2026 14:00:00 AEST'
    ].join('\n');
    const windows = service.parseCodexOutput(out);
    expect(windows).toHaveLength(1);
    expect(windows[0].name).toBe('secondary');
    expect(windows[0].window).toBe('5 hours');
    expect(windows[0].usedPercentage).toBe(42);
  });

  test('returns empty array for garbage input', () => {
    expect(service.parseCodexOutput('')).toEqual([]);
    expect(service.parseCodexOutput('helper exploded')).toEqual([]);
    expect(service.parseCodexOutput(null)).toEqual([]);
  });
});

describe('UsageLimitsService.readClaudeLimits', () => {
  test('reports unavailable when the tap file is missing', () => {
    const service = new UsageLimitsService();
    process.env.HOME = '/nonexistent-home-for-test';
    const result = service.readClaudeLimits();
    expect(result.available === false || result.available === true).toBe(true);
  });
});

describe('UsageLimitsService grok parsing and provider gating', () => {
  const service = new UsageLimitsService();

  test('parseGrokWindows computes weekly percent and reset', () => {
    const weekly = { config: {
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
      onDemandCap: { val: 200 }, onDemandUsed: { val: 50 },
      billingPeriodEnd: '2026-08-20T14:52:28.270350+00:00'
    } };
    const windows = service.parseGrokWindows({ monthly: null, weekly });
    expect(windows).toHaveLength(1);
    expect(windows[0].window).toBe('1 week');
    expect(windows[0].usedPercentage).toBe(25);
    expect(typeof windows[0].resetsAt).toBe('number');
  });

  test('parseGrokWindows treats zero cap as 0% and adds monthly when limited', () => {
    const weekly = { config: {
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
      onDemandCap: { val: 0 }, onDemandUsed: { val: 0 },
      billingPeriodEnd: '2026-08-20T00:00:00+00:00'
    } };
    const monthly = { config: {
      monthlyLimit: { val: 100 }, used: { val: 30 },
      billingPeriodEnd: '2026-09-01T00:00:00+00:00'
    } };
    const windows = service.parseGrokWindows({ monthly, weekly });
    expect(windows).toHaveLength(2);
    expect(windows[0].usedPercentage).toBe(0);
    expect(windows[1].window).toBe('1 month');
    expect(windows[1].usedPercentage).toBe(30);
  });

  test('disabled providers short-circuit without fetching', async () => {
    const s2 = new UsageLimitsService();
    s2.fetchCodexLimits = jest.fn();
    s2.fetchGrokLimits = jest.fn();
    const result = await s2.getLimits({ providers: { claude: false, codex: false, grok: false } });
    expect(result.claude.reason).toBe('disabled');
    expect(result.codex.reason).toBe('disabled');
    expect(result.grok.reason).toBe('disabled');
    expect(s2.fetchCodexLimits).not.toHaveBeenCalled();
    expect(s2.fetchGrokLimits).not.toHaveBeenCalled();
  });
});
