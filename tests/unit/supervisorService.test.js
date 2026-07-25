const fs = require('fs');
const os = require('os');
const path = require('path');

const SupervisorService = require('../../server/supervisorService');
const { QuietTracker, maxLineRepeat, stripControlSequences } = require('../../server/supervisor/supervisorSignals');

function fakeSession({ id, status = 'idle', buffer = '', type = 'claude' }) {
  return { id, type, status, buffer, worktreeId: id.split('-')[0], workspace: 'ws', pty: {} };
}

function harness({ sessions = [], autonomy = 'assist' } = {}) {
  const writes = [];
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));

  const supervisor = new SupervisorService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
  supervisor.init({
    sessionManager: {
      sessions: sessionMap,
      writeToSession: (sessionId, data) => { writes.push({ sessionId, data }); return true; },
      getSessionCwd: () => null
    },
    sessionRecoveryService: { getSession: () => ({ lastAgent: 'claude', lastAgentActive: true }) },
    taskRecordService: { get: () => null },
    activityFeed: { track: () => {} },
    notificationService: { notify: () => {} }
  });
  supervisor.rules.autonomy = autonomy;
  return { supervisor, writes, sessionMap };
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
    const looping = Array(6).fill('Error: cannot find module "widget"').join('\n');
    expect(maxLineRepeat(looping)).toBe(6);
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

  test('observe mode watches without touching anything', async () => {
    const { supervisor, writes } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'observe'
    });

    supervisor.quietTracker.observe('work1-claude', 8);
    supervisor.quietTracker.state.get('work1-claude').lastGrowthAt = Date.now() - 3_600_000;

    const result = await supervisor.tick();
    expect(result.sessionsWatched).toBe(1);
    expect(result.findings[0].conditionId).toBe('stalled');
    expect(result.findings[0].outcome).toBe('observed');
    expect(writes).toEqual([]);
  });

  test('assist mode nudges a stalled session', async () => {
    const { supervisor, writes } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'assist'
    });

    supervisor.quietTracker.observe('work1-claude', 8);
    supervisor.quietTracker.state.get('work1-claude').lastGrowthAt = Date.now() - 3_600_000;

    const result = await supervisor.tick();
    expect(result.findings[0].outcome).toBe('nudged');
    expect(writes.map((w) => w.data)).toEqual(['status? if you are blocked, say what on and stop.', '\r']);
  });

  test('a finding does not re-fire while it is cooling down', async () => {
    const { supervisor, writes } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'assist'
    });

    const stall = () => {
      supervisor.quietTracker.observe('work1-claude', 8);
      supervisor.quietTracker.state.get('work1-claude').lastGrowthAt = Date.now() - 3_600_000;
    };

    stall();
    await supervisor.tick();
    stall();
    const second = await supervisor.tick();

    expect(second.findings[0].outcome).toBe('cooling-down');
    expect(writes).toHaveLength(2);
  });

  test('dry run reports what would happen without doing it', async () => {
    const { supervisor, writes } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'autopilot'
    });

    supervisor.quietTracker.observe('work1-claude', 8);
    supervisor.quietTracker.state.get('work1-claude').lastGrowthAt = Date.now() - 3_600_000;

    const result = await supervisor.tick({ dryRun: true });
    expect(result.findings[0].outcome).toBe('dry-run');
    expect(writes).toEqual([]);
  });

  test('server terminals are not supervised', async () => {
    const { supervisor } = harness({
      sessions: [fakeSession({ id: 'work1-server', type: 'server', status: 'busy' })]
    });
    const result = await supervisor.tick();
    expect(result.sessionsWatched).toBe(0);
  });

  test('actions are written to the audit log', async () => {
    const { supervisor } = harness({
      sessions: [fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' })],
      autonomy: 'assist'
    });

    supervisor.quietTracker.observe('work1-claude', 8);
    supervisor.quietTracker.state.get('work1-claude').lastGrowthAt = Date.now() - 3_600_000;
    await supervisor.tick();

    const audit = fs.readFileSync(supervisor.auditPath(), 'utf8').trim().split('\n').map(JSON.parse);
    expect(audit.at(-1)).toMatchObject({ event: 'finding', conditionId: 'stalled', outcome: 'nudged' });
  });

  test('setAutonomy rejects unknown levels and records real changes', () => {
    const { supervisor } = harness();
    expect(() => supervisor.setAutonomy('yolo')).toThrow(/Unknown autonomy level/);
    expect(supervisor.setAutonomy('autopilot')).toBe('autopilot');

    const audit = fs.readFileSync(supervisor.auditPath(), 'utf8').trim().split('\n').map(JSON.parse);
    expect(audit.at(-1)).toMatchObject({ event: 'autonomy-changed', to: 'autopilot' });
  });

  test('start refuses to run when autonomy is off', () => {
    const { supervisor } = harness({ autonomy: 'off' });
    expect(supervisor.start()).toMatchObject({ running: false });
    supervisor.stop();
  });

  test('the briefing reads as a sentence and leads with what is critical', async () => {
    const { supervisor } = harness({
      sessions: [
        fakeSession({ id: 'work1-claude', status: 'busy', buffer: 'thinking' }),
        fakeSession({ id: 'work2-claude', status: 'busy', buffer: 'usage limit reached ∙ resets 3am' })
      ],
      autonomy: 'assist'
    });

    for (const id of ['work1-claude', 'work2-claude']) {
      supervisor.quietTracker.observe(id, 8);
      supervisor.quietTracker.state.get(id).lastGrowthAt = Date.now() - 3_600_000;
    }
    await supervisor.tick();

    const briefing = supervisor.getBriefing();
    expect(briefing.counts.critical).toBe(1);
    expect(briefing.items[0].severity).toBe('critical');
    expect(briefing.spoken).toMatch(/needs you now/);
  });

  test('an empty fleet briefs as quiet rather than as an error', () => {
    const { supervisor } = harness();
    supervisor.running = true;
    expect(supervisor.getBriefing().spoken).toMatch(/quiet/);
  });
});
