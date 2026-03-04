const voiceCommandService = require('../../server/voiceCommandService');
const commandRegistry = require('../../server/commandRegistry');

describe('VoiceCommandService (rule parsing)', () => {
  test('auto-parses exact command-name phrases for zero-param commands', () => {
    commandRegistry.register('test-zero-param-command', {
      category: 'test',
      description: 'test',
      params: [],
      examples: [],
      handler: () => ({})
    });

    const parsed = voiceCommandService.parseWithRules('test zero param command');
    expect(parsed.command).toBe('test-zero-param-command');
    expect(parsed.params).toEqual({});
  });

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

    const history = voiceCommandService.parseWithRules('open history');
    expect(history.command).toBe('open-history');

    const codexHistory = voiceCommandService.parseWithRules('open codex history');
    expect(codexHistory.command).toBe('open-history');
    expect(codexHistory.params).toEqual({ source: 'codex' });

    const searchHistory = voiceCommandService.parseWithRules('search history for 409 conflict');
    expect(searchHistory.command).toBe('open-history');
    expect(searchHistory.params).toEqual({ query: '409 conflict' });

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

  test('parses review console layout controls', () => {
    const preset = voiceCommandService.parseWithRules('preset review');
    expect(preset.command).toBe('review-console-set-preset');
    expect(preset.params).toEqual({ preset: 'review' });

    const full = voiceCommandService.parseWithRules('fullscreen console');
    expect(full.command).toBe('review-console-set-window');
    expect(full.params).toEqual({ mode: 'fullscreen' });

    const toggle = voiceCommandService.parseWithRules('toggle diff');
    expect(toggle.command).toBe('review-console-toggle-section');
    expect(toggle.params).toEqual({ section: 'diff' });

    const files = voiceCommandService.parseWithRules('files tree');
    expect(files.command).toBe('review-console-files-view');
    expect(files.params).toEqual({ view: 'tree' });

    const embed = voiceCommandService.parseWithRules('embed diff');
    expect(embed.command).toBe('review-console-diff-embed');
    expect(embed.params).toEqual({ enabled: true });
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

  test('parses queue deps/select actions', () => {
    const refresh = voiceCommandService.parseWithRules('refresh queue');
    expect(refresh.command).toBe('queue-refresh');

    const selTicket = voiceCommandService.parseWithRules('select ticket trello:abc123');
    expect(selTicket.command).toBe('queue-select-by-ticket');
    expect(selTicket.params).toEqual({ ticket: 'trello:abc123' });

    const openPrompt = voiceCommandService.parseWithRules('open prompt artifact');
    expect(openPrompt.command).toBe('queue-open-prompt');

    const addDep = voiceCommandService.parseWithRules('add dependency pr:web3dev1337/repo#123');
    expect(addDep.command).toBe('queue-deps-add');
    expect(addDep.params).toEqual({ dependencyIds: 'pr:web3dev1337/repo#123' });

    const removeDep = voiceCommandService.parseWithRules('remove dep trello:abc123');
    expect(removeDep.command).toBe('queue-deps-remove');
    expect(removeDep.params).toEqual({ dependencyIds: 'trello:abc123' });

    const depGraph = voiceCommandService.parseWithRules('open dependency graph');
    expect(depGraph.command).toBe('queue-deps-graph');

    const pairing = voiceCommandService.parseWithRules('open pairing');
    expect(pairing.command).toBe('queue-pairing');

    const conflicts = voiceCommandService.parseWithRules('refresh conflicts');
    expect(conflicts.command).toBe('queue-conflicts-refresh');
  });

  test('parses queue spawn + extra fields', () => {
    const reviewer = voiceCommandService.parseWithRules('spawn reviewer');
    expect(reviewer.command).toBe('queue-spawn-reviewer');

    const fixer = voiceCommandService.parseWithRules('spawn fixer');
    expect(fixer.command).toBe('queue-spawn-fixer');

    const recheck = voiceCommandService.parseWithRules('spawn recheck');
    expect(recheck.command).toBe('queue-spawn-recheck');

    const overnight = voiceCommandService.parseWithRules('spawn overnight');
    expect(overnight.command).toBe('queue-spawn-overnight');

    const pfail = voiceCommandService.parseWithRules('pfail 0.3');
    expect(pfail.command).toBe('queue-set-pfail');
    expect(pfail.params).toEqual({ pFailFirstPass: '0.3' });

    const verify = voiceCommandService.parseWithRules('verify 10');
    expect(verify.command).toBe('queue-set-verify');
    expect(verify.params).toEqual({ verifyMinutes: '10' });

    const pref = voiceCommandService.parseWithRules('prompt ref: pr:web3dev1337/repo#123');
    expect(pref.command).toBe('queue-set-prompt-ref');
    expect(pref.params).toEqual({ promptRef: 'pr:web3dev1337/repo#123' });

    const ticket = voiceCommandService.parseWithRules('ticket: trello:abc123');
    expect(ticket.command).toBe('queue-set-ticket');
    expect(ticket.params).toEqual({ ticket: 'trello:abc123' });

    const openTicket = voiceCommandService.parseWithRules('open ticket');
    expect(openTicket.command).toBe('queue-open-ticket');
  });

  test('parses history resume commands', () => {
    const resume = voiceCommandService.parseWithRules('resume conversation abc123');
    expect(resume.command).toBe('resume-history');
    expect(resume.params).toEqual({ id: 'abc123' });

    const resumeCodex = voiceCommandService.parseWithRules('resume codex sess_123');
    expect(resumeCodex.command).toBe('resume-history');
    expect(resumeCodex.params).toEqual({ source: 'codex', id: 'sess_123' });
  });
});
