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
