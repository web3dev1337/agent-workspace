const voiceCommandService = require('../../server/voiceCommandService');

describe('VoiceCommandService (rule parsing)', () => {
  test('parses workflow mode commands', () => {
    const focus = voiceCommandService.parseWithRules('enter focus mode');
    expect(focus.command).toBe('set-workflow-mode');
    expect(focus.params).toEqual({ mode: 'focus' });

    const review = voiceCommandService.parseWithRules('review mode');
    expect(review.command).toBe('set-workflow-mode');
    expect(review.params).toEqual({ mode: 'review' });
  });

  test('parses tier 2 behavior commands', () => {
    const auto = voiceCommandService.parseWithRules('tier 2 auto');
    expect(auto.command).toBe('set-focus-tier2');
    expect(auto.params).toEqual({ behavior: 'auto' });

    const always = voiceCommandService.parseWithRules('show tier twos');
    expect(always.command).toBe('set-focus-tier2');
    expect(always.params).toEqual({ behavior: 'always' });
  });

  test('parses open process panels', () => {
    const queue = voiceCommandService.parseWithRules('open queue');
    expect(queue.command).toBe('open-queue');

    const blockers = voiceCommandService.parseWithRules('show blockers');
    expect(blockers.command).toBe('queue-blockers');

    const triage = voiceCommandService.parseWithRules('triage queue');
    expect(triage.command).toBe('queue-triage');

    const next = voiceCommandService.parseWithRules('start next review');
    expect(next.command).toBe('queue-next');

    const tasks = voiceCommandService.parseWithRules('open tasks');
    expect(tasks.command).toBe('open-tasks');

    const dash = voiceCommandService.parseWithRules('open dashboard');
    expect(dash.command).toBe('open-dashboard');

    const prs = voiceCommandService.parseWithRules('open prs');
    expect(prs.command).toBe('open-prs');

    const advice = voiceCommandService.parseWithRules('open advisor');
    expect(advice.command).toBe('open-advice');

    const adviceNext = voiceCommandService.parseWithRules('what should i do next');
    expect(adviceNext.command).toBe('open-advice');
  });
});
