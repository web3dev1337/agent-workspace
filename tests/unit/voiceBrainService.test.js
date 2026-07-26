const { VoiceBrainService } = require('../../server/voice/voiceBrainService');

function brain(over = {}) {
  const spoken = [];
  const forwarded = [];
  const b = new VoiceBrainService({ logger: { warn() {} } });
  b.init({
    speechService: { speak: (t) => { spoken.push(t); return { spoken: true }; } },
    commanderContextService: {
      getSnapshot: () => ({
        computed: {
          sessions: over.sessions || [],
          activeWorkspace: over.workspace ? { name: over.workspace } : null,
          capabilitiesSummary: { commandCount: 42 }
        },
        context: { queueSummary: over.queue || [] }
      })
    },
    supervisorService: { getBriefing: () => over.briefing || { spoken: 'Nothing needs you right now. Everything else was handled.' } },
    discordWatchService: { getUntracked: () => over.discord || [] },
    commanderForwarder: over.forwarder || (async (text) => { forwarded.push(text); return over.forwarderReturns ?? true; })
  });
  return { b, spoken, forwarded };
}

describe('VoiceBrainService — fact lane', () => {
  test('"what needs me" reads the supervisor briefing', () => {
    const { b } = brain({ briefing: { spoken: 'work3 has been waiting on a permission for four minutes.' } });
    expect(b.answerFromContext('hey what needs me right now')).toMatch(/waiting on a permission/);
  });

  test('"how many agents are working" counts live sessions', () => {
    const { b } = brain({ sessions: [
      { sessionId: 'a', status: 'busy' }, { sessionId: 'b', status: 'busy' },
      { sessionId: 'c', status: 'waiting' }, { sessionId: 'd', status: 'idle' }
    ] });
    const answer = b.answerFromContext('how many agents are working');
    expect(answer).toMatch(/4 agents/);
    expect(answer).toMatch(/2 working/);
    expect(answer).toMatch(/1 waiting/);
  });

  test('queue question summarizes the top items', () => {
    const { b } = brain({ queue: [{ id: '1', title: 'fix the crash' }, { id: '2', title: 'add leaderboard' }] });
    expect(b.answerFromContext('what is on the queue')).toMatch(/2 items.*fix the crash/);
  });

  test('discord question surfaces the most urgent untracked ask', () => {
    const { b } = brain({ discord: [{ summary: 'fix the save crash urgently' }] });
    expect(b.answerFromContext('anything from discord')).toMatch(/1 thing.*save crash/);
  });

  test('workspace question names the active workspace', () => {
    const { b } = brain({ workspace: 'Zoo Game' });
    expect(b.answerFromContext('what workspace am i in')).toMatch(/Zoo Game/);
  });

  test('an open-ended request is NOT a fact and falls through', () => {
    const { b } = brain();
    expect(b.answerFromContext('spin up a reviewer for PR 12 and ping me when done')).toBeNull();
  });

  test('an action phrasing is never hijacked by the fact lane', () => {
    const { b } = brain({ queue: [{ id: '1', title: 'x' }] });
    // "open the queue" is a command/action, not a "how big is the queue" question.
    expect(b.answerFromContext('open the queue')).toBeNull();
    expect(b.answerFromContext('start a reviewer on the queue')).toBeNull();
  });
});

describe('VoiceBrainService — routing', () => {
  test('a fact question is answered and spoken, never forwarded', async () => {
    const { b, spoken, forwarded } = brain({ sessions: [{ sessionId: 'a', status: 'busy' }] });
    const out = await b.handleUnmatched('how many agents are running');
    expect(out.route).toBe('fact');
    expect(out.handled).toBe(true);
    expect(spoken[0]).toMatch(/1 agent/);
    expect(forwarded).toHaveLength(0);
  });

  test('an open-ended request goes to the Commander and is acknowledged aloud', async () => {
    const { b, spoken, forwarded } = brain();
    const out = await b.handleUnmatched('create a new worktree and start a reviewer on PR 12');
    expect(out.route).toBe('commander');
    expect(out.handled).toBe(true);
    expect(forwarded[0]).toMatch(/create a new worktree/);
    expect(spoken[0]).toMatch(/on it/i);
  });

  test('with no Commander running, it says so instead of failing silently', async () => {
    const b = new VoiceBrainService({ logger: { warn() {} } });
    const spoken = [];
    b.init({ speechService: { speak: (t) => spoken.push(t) }, commanderContextService: { getSnapshot: () => ({}) } });
    const out = await b.handleUnmatched('do something open ended');
    expect(out.route).toBe('none');
    expect(spoken[0]).toMatch(/no Commander/i);
  });

  test('confirmCommand speaks a short confirmation for the fast command lane', () => {
    const { b, spoken } = brain();
    b.confirmCommand('open-queue');
    expect(spoken[0]).toMatch(/done.*open queue/i);
  });
});
