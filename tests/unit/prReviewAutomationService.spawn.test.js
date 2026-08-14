const { PrReviewAutomationService } = require('../../server/prReviewAutomationService');

const buildDeps = ({ agent = 'claude' } = {}) => {
  const writes = [];
  const starts = [];
  const upserts = [];

  const sessionManager = {
    startAgentWithConfig: (sessionId, config) => {
      starts.push({ sessionId, config });
      return true;
    },
    writeToSession: (sessionId, data) => {
      writes.push({ sessionId, data });
    },
    getSessionById: () => null,
    getAllSessions: () => new Map()
  };

  const workspaceManager = {
    getActiveWorkspace: () => ({ id: 'ws1' }),
    getWorkspaceById: () => ({
      terminals: [
        { worktreeId: 'work3', repository: { name: 'local-repo-name' } }
      ]
    })
  };

  const taskRecordService = {
    upsert: (id, patch) => {
      upserts.push({ id, patch });
      return Promise.resolve({ id, ...patch });
    },
    get: () => null,
    list: () => []
  };

  const userSettingsService = {
    getAllSettings: () => ({
      global: { ui: { tasks: { automations: { prReview: { enabled: true, reviewerAgent: agent } } } } }
    })
  };

  const svc = new PrReviewAutomationService({
    sessionManager,
    workspaceManager,
    taskRecordService,
    userSettingsService
  });

  return { svc, writes, starts, upserts };
};

describe('PrReviewAutomationService reviewer spawn', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('spawns claude reviewer with valid agent config (agentId + flags)', async () => {
    const { svc, starts, writes } = buildDeps({ agent: 'claude' });
    const ok = await svc._spawnReviewerForPr(
      { owner: 'me', repo: 'gh-repo', number: 7, title: 'Test PR', prId: 'pr:me/gh-repo#7' },
      svc.getConfig()
    );

    expect(ok).toBe(true);
    expect(starts).toHaveLength(1);
    // Session id must use the LOCAL repo name from the workspace terminal,
    // not the GitHub repo slug.
    expect(starts[0].sessionId).toBe('local-repo-name-work3-claude');
    expect(starts[0].config).toEqual({
      agentId: 'claude',
      mode: 'fresh',
      flags: ['skipPermissions']
    });

    // Prompt is written after init delay, submit ("\r") is a separate write.
    jest.advanceTimersByTime(8_000);
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toContain('PR #7');
    expect(writes[0].data.endsWith('\n')).toBe(false);

    jest.advanceTimersByTime(500);
    expect(writes).toHaveLength(2);
    expect(writes[1].data).toBe('\r');
  });

  test('spawns codex reviewer with yolo flag and longer init delay', async () => {
    const { svc, starts, writes } = buildDeps({ agent: 'codex' });
    const ok = await svc._spawnReviewerForPr(
      { owner: 'me', repo: 'gh-repo', number: 8, title: 'Codex PR', prId: 'pr:me/gh-repo#8' },
      svc.getConfig()
    );

    expect(ok).toBe(true);
    expect(starts[0].config).toEqual({
      agentId: 'codex',
      mode: 'fresh',
      flags: ['yolo']
    });

    jest.advanceTimersByTime(8_000);
    expect(writes).toHaveLength(0);
    jest.advanceTimersByTime(7_000);
    expect(writes).toHaveLength(1);
  });

  test('records reviewer spawn metadata on the task record', async () => {
    const { svc, upserts } = buildDeps();
    await svc._spawnReviewerForPr(
      { owner: 'me', repo: 'gh-repo', number: 9, title: 'Meta PR', prId: 'pr:me/gh-repo#9' },
      svc.getConfig()
    );

    const patch = upserts.find(u => u.id === 'pr:me/gh-repo#9')?.patch || {};
    expect(patch.reviewerWorktreeId).toBe('work3');
    expect(typeof patch.reviewerSpawnedAt).toBe('string');
    expect(typeof patch.reviewStartedAt).toBe('string');
  });

  test('returns false when no worktree is available', async () => {
    const { svc, starts } = buildDeps();
    svc.workspaceManager.getWorkspaceById = () => ({ terminals: [] });

    const ok = await svc._spawnReviewerForPr(
      { owner: 'me', repo: 'gh-repo', number: 10, prId: 'pr:me/gh-repo#10' },
      svc.getConfig()
    );

    expect(ok).toBe(false);
    expect(starts).toHaveLength(0);
  });
});

describe('PrReviewAutomationService feedback routing (prompt-cache freshness)', () => {
  const buildFeedbackDeps = ({ promptSentAt, autoSpawnFixer = true, handoffNotes = '' } = {}) => {
    const writes = [];
    const starts = [];
    const upserts = [];

    const sessions = new Map([
      ['gh-repo-work1-claude', { status: 'busy' }]
    ]);

    const sessionManager = {
      startAgentWithConfig: (sessionId, config) => { starts.push({ sessionId, config }); return true; },
      writeToSession: (sessionId, data) => { writes.push({ sessionId, data }); },
      getSessionById: () => null,
      getAllSessions: () => sessions
    };

    const workspaceManager = {
      getActiveWorkspace: () => ({ id: 'ws1' }),
      getWorkspaceById: () => ({
        terminals: [{ worktreeId: 'work9', repository: { name: 'gh-repo' } }]
      })
    };

    const record = {
      promptSentAt,
      evidence: handoffNotes ? { handoff: { notes: handoffNotes } } : undefined
    };

    const taskRecordService = {
      get: () => record,
      upsert: (id, patch) => { upserts.push({ id, patch }); return Promise.resolve({ id, ...patch }); },
      list: () => []
    };

    const userSettingsService = {
      getAllSettings: () => ({
        global: { ui: { tasks: { automations: { prReview: {
          enabled: true, autoFeedbackToAuthor: true, autoSpawnFixer
        } } } } }
      })
    };

    const svc = new PrReviewAutomationService({ sessionManager, workspaceManager, taskRecordService, userSettingsService });
    return { svc, writes, starts, upserts };
  };

  test('warm cache: feedback goes into the original session', async () => {
    const { svc, writes, starts } = buildFeedbackDeps({
      promptSentAt: new Date(Date.now() - 10 * 60_000).toISOString()
    });

    await svc._sendFeedbackToAuthor('pr:me/gh-repo#4', { number: 4, reviewBody: 'fix it', reviewUser: 'bot' }, svc.getConfig());

    expect(writes).toHaveLength(1);
    expect(writes[0].sessionId).toBe('gh-repo-work1-claude');
    expect(writes[0].data).toContain('CHANGES REQUESTED');
    expect(starts).toHaveLength(0);
  });

  test('cold cache: spawns a fresh fixer seeded with handoff notes instead', async () => {
    const { svc, writes, starts, upserts } = buildFeedbackDeps({
      promptSentAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      handoffNotes: 'branch feature/x; polish remaining'
    });

    await svc._sendFeedbackToAuthor('pr:me/gh-repo#5', { number: 5, reviewBody: 'edge case broken', reviewUser: 'bot' }, svc.getConfig());

    expect(starts).toHaveLength(1);
    expect(starts[0].sessionId).toBe('gh-repo-work9-claude');
    expect(starts[0].config.mode).toBe('fresh');
    expect(writes).toHaveLength(0); // nothing written into the stale session

    const fixerPatch = upserts.find(u => u.patch.fixerWorktreeId)?.patch;
    expect(fixerPatch.fixerWorktreeId).toBe('work9');
  });

  test('cold cache with fixer disabled: still delivers to the stale session', async () => {
    const { svc, writes, starts } = buildFeedbackDeps({
      promptSentAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      autoSpawnFixer: false
    });

    await svc._sendFeedbackToAuthor('pr:me/gh-repo#6', { number: 6, reviewBody: 'nit', reviewUser: 'bot' }, svc.getConfig());

    expect(starts).toHaveLength(0);
    expect(writes).toHaveLength(1);
  });

  test('fresh fixer prompt contains feedback and handoff notes', async () => {
    const { svc, starts } = buildFeedbackDeps({
      promptSentAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      handoffNotes: 'the tricky part is the retry loop'
    });

    jest.useFakeTimers();
    const writes = [];
    svc.sessionManager.writeToSession = (sessionId, data) => writes.push({ sessionId, data });

    await svc._sendFeedbackToAuthor('pr:me/gh-repo#7', { number: 7, reviewBody: 'race condition in retry' }, svc.getConfig());
    expect(starts).toHaveLength(1);

    jest.advanceTimersByTime(8_000);
    expect(writes[0].data).toContain('race condition in retry');
    expect(writes[0].data).toContain('the tricky part is the retry loop');
    expect(writes[0].data).toContain('gh pr checkout 7');
    jest.useRealTimers();
  });
});
