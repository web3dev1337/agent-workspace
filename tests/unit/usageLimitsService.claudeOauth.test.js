const { UsageLimitsService } = require('../../server/usageLimitsService');

describe('UsageLimitsService.parseClaudeOauthLimits', () => {
  const service = new UsageLimitsService();

  it('maps session/weekly_all/weekly_scoped limits to buckets', () => {
    const parsed = service.parseClaudeOauthLimits({
      limits: [
        { kind: 'session', group: 'session', percent: 12, resets_at: '2026-08-19T02:09:59+00:00' },
        { kind: 'weekly_all', group: 'weekly', percent: 21, resets_at: '2026-08-19T03:59:59+00:00' },
        { kind: 'weekly_scoped', group: 'weekly', percent: 31, resets_at: '2026-08-19T03:59:59+00:00', scope: { model: { display_name: 'Fable' } } }
      ]
    });
    expect(parsed.fiveHour).toEqual({ usedPercentage: 12, resetsAt: Math.round(Date.parse('2026-08-19T02:09:59+00:00') / 1000) });
    expect(parsed.sevenDay.usedPercentage).toBe(21);
    expect(parsed.extraBuckets).toEqual([
      expect.objectContaining({ key: 'seven_day_fable', usedPercentage: 31 })
    ]);
  });

  it('ignores malformed or nameless scoped limits and returns null when empty', () => {
    expect(service.parseClaudeOauthLimits({ limits: [] })).toBeNull();
    expect(service.parseClaudeOauthLimits(null)).toBeNull();
    const parsed = service.parseClaudeOauthLimits({
      limits: [
        { kind: 'weekly_scoped', group: 'weekly', percent: 'NaN' },
        { kind: 'weekly_scoped', group: 'weekly', percent: 9, scope: { model: {} } },
        { kind: 'session', group: 'session', percent: 5, resets_at: 'garbage' }
      ]
    });
    expect(parsed.fiveHour).toEqual({ usedPercentage: 5, resetsAt: null });
    expect(parsed.extraBuckets).toEqual([]);
  });
});
