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

    const conveyor = voiceCommandService.parseWithRules('conveyor t2');
    expect(conveyor.command).toBe('queue-conveyor-t2');

    const next = voiceCommandService.parseWithRules('start next review');
    expect(next.command).toBe('queue-next');

    const tasks = voiceCommandService.parseWithRules('open tasks');
    expect(tasks.command).toBe('open-tasks');

    const dash = voiceCommandService.parseWithRules('open dashboard');
    expect(dash.command).toBe('open-dashboard');

    const prs = voiceCommandService.parseWithRules('open prs');
    expect(prs.command).toBe('open-prs');

    const telemetry = voiceCommandService.parseWithRules('open telemetry');
    expect(telemetry.command).toBe('open-telemetry');

    const activity = voiceCommandService.parseWithRules('open activity');
    expect(activity.command).toBe('open-activity');

    const advice = voiceCommandService.parseWithRules('open advisor');
    expect(advice.command).toBe('open-advice');

    const adviceNext = voiceCommandService.parseWithRules('what should i do next');
    expect(adviceNext.command).toBe('open-advice');
  });

  test('parses queue review surface helpers', () => {
    const consoleCmd = voiceCommandService.parseWithRules('open review console');
    expect(consoleCmd.command).toBe('queue-open-console');

    const diffCmd = voiceCommandService.parseWithRules('open diff');
    expect(diffCmd.command).toBe('queue-open-diff');
  });

  test('parses queue review lifecycle actions', () => {
    const approve = voiceCommandService.parseWithRules('approve this pr');
    expect(approve.command).toBe('queue-approve');

    const approveWithBody = voiceCommandService.parseWithRules('approve: lgtm ✅');
    expect(approveWithBody.command).toBe('queue-approve');
    expect(approveWithBody.params).toEqual({ body: 'lgtm ✅' });

    const changes = voiceCommandService.parseWithRules('request changes: please add a test');
    expect(changes.command).toBe('queue-request-changes');
    expect(changes.params).toEqual({ body: 'please add a test' });

    const merge = voiceCommandService.parseWithRules('merge this pr');
    expect(merge.command).toBe('queue-merge');

    const squash = voiceCommandService.parseWithRules('squash merge');
    expect(squash.command).toBe('queue-merge');
    expect(squash.params).toEqual({ method: 'squash' });
  });

  test('parses queue navigation + metadata actions', () => {
    const prev = voiceCommandService.parseWithRules('prev');
    expect(prev.command).toBe('queue-prev');

    const inspect = voiceCommandService.parseWithRules('open inspector');
    expect(inspect.command).toBe('queue-open-inspector');

    const timerStart = voiceCommandService.parseWithRules('start review timer');
    expect(timerStart.command).toBe('queue-review-timer-start');

    const timerStop = voiceCommandService.parseWithRules('stop review timer');
    expect(timerStop.command).toBe('queue-review-timer-stop');

    const tier = voiceCommandService.parseWithRules('tier 3');
    expect(tier.command).toBe('queue-set-tier');
    expect(tier.params).toEqual({ tier: '3' });

    const risk = voiceCommandService.parseWithRules('risk high');
    expect(risk.command).toBe('queue-set-risk');
    expect(risk.params).toEqual({ risk: 'high' });

    const outcome = voiceCommandService.parseWithRules('set outcome needs_fix');
    expect(outcome.command).toBe('queue-set-outcome');
    expect(outcome.params).toEqual({ outcome: 'needs_fix' });

    const notes = voiceCommandService.parseWithRules('notes: please add a test');
    expect(notes.command).toBe('queue-set-notes');
    expect(notes.params).toEqual({ notes: 'please add a test' });

    const claim = voiceCommandService.parseWithRules('claim as alex');
    expect(claim.command).toBe('queue-claim');
    expect(claim.params).toEqual({ who: 'alex' });

    const release = voiceCommandService.parseWithRules('release claim');
    expect(release.command).toBe('queue-release');

    const assign = voiceCommandService.parseWithRules('assign to alex');
    expect(assign.command).toBe('queue-assign');
    expect(assign.params).toEqual({ who: 'alex' });

    const unassign = voiceCommandService.parseWithRules('unassign');
    expect(unassign.command).toBe('queue-unassign');
  });
});
