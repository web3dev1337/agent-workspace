const fs = require('fs');
const os = require('os');
const path = require('path');

const SupervisorService = require('../../server/supervisorService');
const { QuietTracker, maxLineRepeat, stripControlSequences } = require('../../server/supervisor/supervisorSignals');

function fakeSession({ id, status = 'idle', buffer = '', type = 'claude' }) {
  return { id, type, status, buffer, worktreeId: id.split('-')[0], workspace: 'ws', pty: {} };
}

function harness({ sessions = [], autonomy = 'autopilot', tier = null, commanderSender = null } = {}) {
  const writes = [];
  const notifications = [];
  const spoken = [];
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));

  const supervisor = new SupervisorService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
  supervisor.init({
    sessionManager: {
      sessions: sessionMap,
      writeToSession: (sessionId, data) => { writes.push({ sessionId, data }); return true; },
      getSessionCwd: () => null
    },
    sessionRecoveryService: { getSession: () => ({ lastAgent: 'claude', lastAgentActive: true }) },
    taskRecordService: { get: () => (tier ? { tier } : null) },
    activityFeed: { track: () => {} },
    notificationService: { notify: (...args) => notifications.push(args) },
    speechService: { speak: (text) => spoken.push(text) },
    commanderSender
  });
  supervisor.rules.autonomy = autonomy;

  // Push a session past every quiet-time threshold without waiting for it.
  const goQuiet = (id) => {
    supervisor.quietTracker.observe(id, 8);
    supervisor.quietTracker.state.get(id).lastGrowthAt = Date.now() - 3_600_000;
  };

  return { supervisor, writes, notifications, spoken, goQuiet };
}

describe('supervisor signals', () => {
  test('quiet time only accumulates while the buffer is unchanged', () => {
    let now = 1_000_000;
    const tracker = new QuietTracker({ now: () => now });

    expect(tracker.observe('a', 100)).toBe(0);
    now += 60_000;
    expect(tracker.observe('a', 100)).toBe(60);
    now += 60_000;
    expect(tracker.observe('a', 250)).toBe(0);
    now += 30_000;
    expect(tracker.observe('a', 250)).toBe(30);
  });

  test('sessions that disappear are pruned from the tracker', () => {
    const tracker = new QuietTracker();
    tracker.observe('a', 1);
    tracker.observe('b', 1);
    tracker.prune(['a']);
    expect(tracker.state.has('b')).toBe(false);
  });

  test('repeated-line detection ignores short lines', () => {
    expect(maxLineRepeat(Array(6).fill('Error: cannot find module "widget"').join('\n'))).toBe(6);
    expect(maxLineRepeat(Array(6).fill('ok').join('\n'))).toBe(0);
  });

  test('ANSI escape sequences are stripped before matching', () => {
    expect(stripControlSequences('\x1b[31mError\x1b[0m: boom')).toBe('Error: boom');
  });
});

describe('SupervisorService', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-test-'));
    process.env.AGENT_WORKSPACE_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a stall is fixed silently — no notification for something it handled', async () => {
    const { supervisor, writes, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })]
    });
    goQuiet('work1-claude');

    const result = await supervisor.tick();
    expect(result.findings[0].outcome).toBe('resolved');
    expect(writes.map((w) => w.data)).toEqual([expect.stringMatching(/status\?/), '\r']);
    expect(notifications).toEqual([]);
  });

  test('a human is only reached after repair attempts are exhausted', async () => {
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      tier: 1
    });

    const outcomes = [];
    for (let i = 0; i < 6 && !outcomes.includes('interrupted'); i += 1) {
      goQuiet('work1-claude');
      supervisor.cooldowns.clear();
      outcomes.push((await supervisor.tick()).findings[0].outcome);
    }

    expect(outcomes.slice(0, 3)).toEqual(['resolved', 'resolved', 'resolved']);
    expect(outcomes.at(-1)).toBe('interrupted');
    expect(notifications).toHaveLength(1);
  });

  test('the same problem never interrupts twice in quick succession', async () => {
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      tier: 1
    });

    for (let i = 0; i < 8; i += 1) {
      goQuiet('work1-claude');
      supervisor.cooldowns.clear();
      await supervisor.tick();
    }

    // Repeated ticks past the escalation point must not become a drumbeat, even
    // at an urgency score that overrides quiet hours and the hourly budget.
    expect(notifications).toHaveLength(1);
    expect(supervisor.digest.pending()[0].heldBecause).toMatch(/already interrupted/);
  });

  test('background work never interrupts — it goes to the digest instead', async () => {
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      tier: 4
    });

    for (let i = 0; i < 6; i += 1) {
      goQuiet('work1-claude');
      supervisor.cooldowns.clear();
      await supervisor.tick();
    }

    expect(notifications).toEqual([]);
    expect(supervisor.digest.pending()).toHaveLength(1);
    expect(supervisor.digest.pending()[0].heldBecause).toMatch(/below interrupt threshold/);
  });

  test('a problem that heals is dropped from the digest, never mentioned', async () => {
    const session = fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' });
    const { supervisor, goQuiet } = harness({ sessions: [session], tier: 4 });

    for (let i = 0; i < 5; i += 1) {
      goQuiet('work1-claude');
      supervisor.cooldowns.clear();
      await supervisor.tick();
    }
    expect(supervisor.digest.pending()).toHaveLength(1);

    session.status = 'idle';
    session.buffer = 'done';
    await supervisor.tick();

    expect(supervisor.digest.pending()).toEqual([]);
    expect(supervisor.attempts.has('work1-claude:stalled')).toBe(false);
  });

  test('a usage limit resolves itself and schedules a resume', async () => {
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: '5-hour limit reached ∙ resets 3am' })]
    });
    goQuiet('work1-claude');

    const result = await supervisor.tick();
    expect(result.findings[0].conditionId).toBe('usage-limit-reached');
    expect(result.findings[0].outcome).toBe('resolved');
    expect(notifications).toEqual([]);
    expect(supervisor.getStatus().scheduledResumes).toHaveLength(1);
  });

  test('an error loop is delegated to the Commander, not dumped on the human', async () => {
    const briefs = [];
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({
        id: 'work1-claude',
        status: 'busy',
        buffer: Array(6).fill('Error: cannot find module "widget"').join('\n')
      })],
      commanderSender: async (text) => { briefs.push(text); return true; }
    });
    goQuiet('work1-claude');

    const result = await supervisor.tick();
    expect(result.findings[0].outcome).toBe('delegated');
    expect(briefs).toHaveLength(1);
    expect(notifications).toEqual([]);
  });

  test('observe mode watches without touching anything', async () => {
    const { supervisor, writes, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'observe'
    });
    goQuiet('work1-claude');

    const result = await supervisor.tick();
    expect(result.findings[0].outcome).toBe('observed');
    expect(writes).toEqual([]);
  });

  test('dry run reports the plan without carrying it out', async () => {
    const { supervisor, writes, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })]
    });
    goQuiet('work1-claude');

    const result = await supervisor.tick({ dryRun: true });
    expect(result.findings[0].outcome).toBe('dry-run');
    expect(result.findings[0].intent).toBe('resolve');
    expect(writes).toEqual([]);
  });

  test('server terminals are not supervised', async () => {
    const { supervisor } = harness({ sessions: [fakeSession({ id: 'work1-server', type: 'server', status: 'busy' })] });
    expect((await supervisor.tick()).sessionsWatched).toBe(0);
  });

  test('every action lands in the audit log', async () => {
    const { supervisor, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })]
    });
    goQuiet('work1-claude');
    await supervisor.tick();

    const audit = fs.readFileSync(supervisor.auditPath(), 'utf8').trim().split('\n').map(JSON.parse);
    expect(audit.at(-1)).toMatchObject({ event: 'finding', conditionId: 'stalled', outcome: 'resolved', intent: 'resolve' });
  });

  test('setAutonomy rejects unknown levels and records real changes', () => {
    const { supervisor } = harness();
    expect(() => supervisor.setAutonomy('yolo')).toThrow(/Unknown autonomy level/);
    expect(supervisor.setAutonomy('assist')).toBe('assist');

    const audit = fs.readFileSync(supervisor.auditPath(), 'utf8').trim().split('\n').map(JSON.parse);
    expect(audit.at(-1)).toMatchObject({ event: 'autonomy-changed', to: 'assist' });
  });

  test('start refuses to run when autonomy is off', () => {
    const { supervisor } = harness({ autonomy: 'off' });
    expect(supervisor.start()).toMatchObject({ running: false });
    supervisor.stop();
  });

  test('the briefing leads with what was handled, not with problems', async () => {
    const { supervisor, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })]
    });
    supervisor.running = true;
    goQuiet('work1-claude');
    await supervisor.tick();

    const briefing = supervisor.getBriefing();
    expect(briefing.handledRecently).toBe(1);
    expect(briefing.waiting).toEqual([]);
    expect(briefing.spoken).toMatch(/I handled 1 thing/);
    expect(briefing.spoken).toMatch(/Nothing is waiting on you/);
  });

  test('delivering the digest batches everything into one message', async () => {
    const { supervisor, notifications, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      tier: 4
    });

    for (let i = 0; i < 5; i += 1) {
      goQuiet('work1-claude');
      supervisor.cooldowns.clear();
      await supervisor.tick();
    }

    const delivered = supervisor.deliverDigest();
    expect(delivered.items).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(supervisor.digest.pending()).toEqual([]);
  });

  test('stopping clears scheduled resumes so nothing fires after shutdown', async () => {
    const { supervisor, goQuiet } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'limit reached ∙ resets 3am' })]
    });
    goQuiet('work1-claude');
    await supervisor.tick();
    expect(supervisor.resumeTimers.size).toBe(1);

    supervisor.stop();
    expect(supervisor.resumeTimers.size).toBe(0);
  });
});
