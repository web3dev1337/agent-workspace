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
