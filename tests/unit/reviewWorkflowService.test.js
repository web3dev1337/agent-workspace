const fs = require('fs');
const os = require('os');
const path = require('path');

const { ReviewWorkflowService } = require('../../server/reviewWorkflowService');
const { TaskRecordService } = require('../../server/taskRecordService');
const { EvidenceService } = require('../../server/evidenceService');

const WORKFLOW_CONFIG = {
  version: 1,
  roles: {
    general: { label: 'General reviewer', focusBullets: ['Correctness'] },
    security: { label: 'Security reviewer', focusBullets: ['Injection'] }
  },
  workflows: {
    standard: { label: 'Standard', stages: [{ role: 'general', agentId: 'claude', model: 'sonnet' }] },
    hardened: {
      label: 'Hardened',
      stages: [
        { role: 'security', agentId: 'codex', model: 'gpt-5.5', effort: 'high' },
        { role: 'general', agentId: 'claude', model: 'opus' }
      ]
    }
  },
  riskDefaults: { low: 'standard', high: 'hardened' },
  stageTimeoutMinutes: 45
};

const build = ({ reviews = [] } = {}) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-wf-'));
  const configPath = path.join(tmp, 'review-workflows.json');
  fs.writeFileSync(configPath, JSON.stringify(WORKFLOW_CONFIG));

  const taskRecordService = new TaskRecordService({ filePath: path.join(tmp, 'task-records.json') });

  const starts = [];
  const sessionManager = {
    startAgentWithConfig: (sessionId, config) => {
      starts.push({ sessionId, config });
      return true;
    },
    writeToSession: () => {},
    getSessionById: () => null
  };

  const workspaceManager = {
    getActiveWorkspace: () => ({ id: 'ws1' }),
    getWorkspaceById: () => ({
      terminals: [
        { worktreeId: 'work5', repository: { name: 'repo-local' } },
        { worktreeId: 'work6', repository: { name: 'repo-local' } }
      ]
    })
  };

  const prReviews = { list: reviews };
  const pullRequestService = {
    getPullRequest: async () => ({ reviews: prReviews.list })
  };

  const evidenceService = new EvidenceService({
    taskRecordService,
    pullRequestService: {
      getPullRequestDetailsByUrl: async () => ({ files: [], conversation: { issueComments: [], reviews: [] } }),
      getPullRequest: async () => ({ body: '' })
    }
  });

  const svc = new ReviewWorkflowService({
    taskRecordService,
    pullRequestService,
    sessionManager,
    workspaceManager,
    evidenceService,
    configPath,
    userConfigPath: path.join(tmp, 'user-override.json')
  });

  return { svc, taskRecordService, starts, prReviews, tmp };
};

afterEach(() => {
  // Stop any pollers a test started.
  if (ReviewWorkflowService.instance) ReviewWorkflowService.instance = null;
});

describe('ReviewWorkflowService config', () => {
  test('loads config and merges user override', () => {
    const { svc, tmp } = build();
    fs.writeFileSync(path.join(tmp, 'user-override.json'), JSON.stringify({
      riskDefaults: { low: 'hardened' },
      workflows: { standard: { label: 'Renamed' } }
    }));

    const cfg = svc.getConfig({ force: true });
    expect(cfg.riskDefaults.low).toBe('hardened');
    expect(cfg.workflows.standard.label).toBe('Renamed');
    expect(cfg.workflows.standard.stages).toHaveLength(1);
    expect(svc.getWorkflowForRisk('high')).toBe('hardened');
  });
});

describe('ReviewWorkflowService runs', () => {
  test('startWorkflow spawns stage 1 with per-role agent/model/effort', async () => {
    const { svc, starts } = build();
    const run = await svc.startWorkflow('pr:me/repo#12', 'hardened');
    svc.stopPolling();

    expect(run.status).toBe('running');
    expect(run.stageIndex).toBe(0);
    expect(run.stages[0]).toMatchObject({ role: 'security', status: 'running', worktreeId: 'work5' });

    expect(starts).toHaveLength(1);
    expect(starts[0].sessionId).toBe('repo-local-work5-claude');
    expect(starts[0].config).toMatchObject({
      agentId: 'codex',
      mode: 'fresh',
      flags: ['yolo'],
      model: 'gpt-5.5',
      reasoning: 'high'
    });
  });

  test('approved review advances to the next stage and records evidence', async () => {
    const { svc, taskRecordService, starts, prReviews } = build();
    await svc.startWorkflow('pr:me/repo#12', 'hardened');
    svc.stopPolling();

    prReviews.list = [{
      state: 'APPROVED',
      submittedAt: new Date(Date.now() + 1000).toISOString(),
      body: 'No injection issues found.',
      author: { login: 'reviewer-bot' }
    }];

    await svc.pollActiveRuns();
    svc.stopPolling();

    const run = svc.getRun('pr:me/repo#12');
    expect(run.stages[0]).toMatchObject({ status: 'done', verdict: 'approved' });
    expect(run.stages[1].status).toBe('running');
    expect(run.stageIndex).toBe(1);
    expect(starts).toHaveLength(2);
    expect(starts[1].config).toMatchObject({ agentId: 'claude', model: 'opus' });

    const evidence = taskRecordService.get('pr:me/repo#12').evidence;
    expect(evidence.reviews).toHaveLength(1);
    expect(evidence.reviews[0]).toMatchObject({ role: 'security', verdict: 'approved', by: 'reviewer-bot' });
  });

  test('changes_requested blocks the workflow for fixing', async () => {
    const { svc, prReviews } = build();
    await svc.startWorkflow('pr:me/repo#3', 'standard');
    svc.stopPolling();

    prReviews.list = [{
      state: 'CHANGES_REQUESTED',
      submittedAt: new Date(Date.now() + 1000).toISOString(),
      body: 'Broken edge case.'
    }];

    await svc.pollActiveRuns();
    svc.stopPolling();

    const run = svc.getRun('pr:me/repo#3');
    expect(run.status).toBe('blocked_fix');
    expect(run.stages[0].verdict).toBe('needs_fix');
  });

  test('final stage approval completes the workflow', async () => {
    const { svc, prReviews } = build();
    await svc.startWorkflow('pr:me/repo#4', 'standard');
    svc.stopPolling();

    prReviews.list = [{
      state: 'APPROVED',
      submittedAt: new Date(Date.now() + 1000).toISOString(),
      body: 'LGTM'
    }];

    await svc.pollActiveRuns();
    svc.stopPolling();

    const run = svc.getRun('pr:me/repo#4');
    expect(run.status).toBe('complete');
    expect(typeof run.completedAt).toBe('string');
  });

  test('stage timeout stalls the run', async () => {
    const { svc, taskRecordService } = build();
    await svc.startWorkflow('pr:me/repo#5', 'standard');
    svc.stopPolling();

    // Backdate the spawn beyond the timeout.
    const run = svc.getRun('pr:me/repo#5');
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    await taskRecordService.upsert('pr:me/repo#5', {
      reviewWorkflow: { ...run, stages: [{ ...run.stages[0], spawnedAt: past }] }
    });

    await svc.pollActiveRuns();
    svc.stopPolling();

    const after = svc.getRun('pr:me/repo#5');
    expect(after.status).toBe('stalled');
    expect(after.stages[0].status).toBe('failed');
  });

  test('advanceWorkflow skips a stalled stage', async () => {
    const { svc, prReviews } = build();
    await svc.startWorkflow('pr:me/repo#6', 'hardened');
    svc.stopPolling();

    await svc.advanceWorkflow('pr:me/repo#6');
    svc.stopPolling();

    const run = svc.getRun('pr:me/repo#6');
    expect(run.stages[0].status).toBe('skipped');
    expect(run.stages[1].status).toBe('running');
    expect(run.stageIndex).toBe(1);
    expect(prReviews.list).toHaveLength(0);
  });

  test('stage prompt includes role focus, evidence instructions and prior verdicts', async () => {
    const { svc } = build();
    const prompt = svc._buildStagePrompt({
      owner: 'me',
      repo: 'repo',
      number: 9,
      title: 'Add thing',
      stage: { role: 'security', agentId: 'codex', model: 'gpt-5.5' },
      stageIndex: 1,
      stageCount: 2,
      priorStages: [{ role: 'general', verdict: 'approved' }],
      standards: ['CLAUDE.md']
    });

    expect(prompt).toContain('Security reviewer');
    expect(prompt).toContain('agent-evidence');
    expect(prompt).toContain('gh pr review 9');
    expect(prompt).toContain('- general: approved');
    expect(prompt).toContain('READ-ONLY');
  });
});
