const fs = require('fs');
const os = require('os');
const path = require('path');

const { TaskRecordService } = require('../../server/taskRecordService');

describe('TaskRecordService', () => {
  test('upsert normalizes tier/risk/pFail and persists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');

    const svc = new TaskRecordService({ filePath });
    const id = 'pr:me/repo#1';

    const rec = await svc.upsert(id, {
      tier: 3,
      changeRisk: 'HIGH',
      baseImpactRisk: 'medium',
      pFailFirstPass: 1.4,
      verifyMinutes: 12.7,
      promptVisibility: 'private'
    });

    expect(rec.tier).toBe(3);
    expect(rec.changeRisk).toBe('high');
    expect(rec.baseImpactRisk).toBe('medium');
    expect(rec.pFailFirstPass).toBe(1);
    expect(rec.verifyMinutes).toBe(13);
    expect(rec.promptVisibility).toBe('private');

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.records[id].tier).toBe(3);
  });

  test('upsert sets createdAt once and preserves it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec1 = await svc.upsert('task:created-at', { tier: 1 });
    expect(typeof rec1.createdAt).toBe('string');
    expect(typeof rec1.updatedAt).toBe('string');

    await new Promise((r) => setTimeout(r, 5));

    const rec2 = await svc.upsert('task:created-at', { tier: 2 });
    expect(rec2.createdAt).toBe(rec1.createdAt);
    expect(rec2.updatedAt).not.toBe(rec1.updatedAt);
  });

  test('upsert supports telemetry timestamps and prompt chars', async () => {
    const service = new TaskRecordService({ filePath: '/tmp/test-task-records-telemetry.json' });
    const rec = await service.upsert('task:telemetry', {
      reviewStartedAt: '2026-01-25T00:00:00Z',
      reviewEndedAt: '2026-01-25T00:01:00Z',
      promptSentAt: '2026-01-25T00:00:10Z',
      promptChars: 123,
      reviewerSpawnedAt: '2026-01-25T00:00:11Z',
      reviewerWorktreeId: 'work9',
      reviewerSessionId: 'demo-work9-claude',
      reviewerAgent: 'CLAUDE',
      reviewSourceSessionId: 'demo-work1-claude',
      reviewSourceWorktreeId: 'work1',
      fixerSpawnedAt: '2026-01-25T00:00:12Z',
      fixerWorktreeId: 'work10',
      recheckSpawnedAt: '2026-01-25T00:00:13Z',
      recheckWorktreeId: 'work11',
      latestReviewSummary: 'Fix the edge case.',
      latestReviewBody: 'Fix the edge case. Add a regression test.',
      latestReviewOutcome: 'NEEDS_FIX',
      latestReviewUser: 'review-bot',
      latestReviewUrl: 'https://github.com/acme/demo/pull/1#pullrequestreview-1',
      latestReviewSubmittedAt: '2026-01-25T00:00:14Z',
      latestReviewAgent: 'CODEX',
      latestReviewDeliveredAt: '2026-01-25T00:00:15Z'
    });

    expect(rec.reviewStartedAt).toBe('2026-01-25T00:00:00.000Z');
    expect(rec.reviewEndedAt).toBe('2026-01-25T00:01:00.000Z');
    expect(rec.promptSentAt).toBe('2026-01-25T00:00:10.000Z');
    expect(rec.promptChars).toBe(123);
    expect(rec.reviewerSpawnedAt).toBe('2026-01-25T00:00:11.000Z');
    expect(rec.reviewerWorktreeId).toBe('work9');
    expect(rec.reviewerSessionId).toBe('demo-work9-claude');
    expect(rec.reviewerAgent).toBe('claude');
    expect(rec.reviewSourceSessionId).toBe('demo-work1-claude');
    expect(rec.reviewSourceWorktreeId).toBe('work1');
    expect(rec.fixerSpawnedAt).toBe('2026-01-25T00:00:12.000Z');
    expect(rec.fixerWorktreeId).toBe('work10');
    expect(rec.recheckSpawnedAt).toBe('2026-01-25T00:00:13.000Z');
    expect(rec.recheckWorktreeId).toBe('work11');
    expect(rec.latestReviewSummary).toBe('Fix the edge case.');
    expect(rec.latestReviewBody).toBe('Fix the edge case. Add a regression test.');
    expect(rec.latestReviewOutcome).toBe('needs_fix');
    expect(rec.latestReviewUser).toBe('review-bot');
    expect(rec.latestReviewUrl).toBe('https://github.com/acme/demo/pull/1#pullrequestreview-1');
    expect(rec.latestReviewSubmittedAt).toBe('2026-01-25T00:00:14.000Z');
    expect(rec.latestReviewAgent).toBe('codex');
    expect(rec.latestReviewDeliveredAt).toBe('2026-01-25T00:00:15.000Z');
  });

  test('upsert supports prompt repo location fields', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:prompt', {
      promptRef: 'task:prompt',
      promptVisibility: 'shared',
      promptRepoRoot: '/tmp/mock-repo',
      promptPath: '.orchestrator/prompts/task-prompt.md'
    });

    expect(rec.promptVisibility).toBe('shared');
    expect(rec.promptRepoRoot).toBe('/tmp/mock-repo');
    expect(rec.promptPath).toBe('.orchestrator/prompts/task-prompt.md');

    const rec2 = await svc.upsert('task:prompt', { promptRepoRoot: null, promptPath: null });
    expect(rec2.promptRepoRoot).toBeUndefined();
    expect(rec2.promptPath).toBeUndefined();
  });

  test('upsert normalizes dependencies and supports done', async () => {
    const { TaskRecordService } = require('../../server/taskRecordService');
    const os = require('os');
    const path = require('path');
    const fs = require('fs').promises;

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:1', { dependencies: ['  a ', 'a', '', 'b'], done: true });
    expect(rec.dependencies).toEqual(['a', 'b']);
    expect(typeof rec.doneAt).toBe('string');

    const rec2 = await svc.upsert('task:1', { done: false });
    expect(rec2.doneAt).toBeUndefined();
  });

  test('upsert supports reviewedAt and reviewOutcome', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:2', { reviewOutcome: 'NEEDS_FIX' });
    expect(rec.reviewOutcome).toBe('needs_fix');
    expect(typeof rec.reviewedAt).toBe('string');

    const rec2 = await svc.upsert('task:2', { reviewed: false });
    expect(rec2.reviewedAt).toBeUndefined();
  });

  test('upsert supports overnight runner fields', async () => {
    const svc = TaskRecordService.getInstance();
    svc.data = { version: 1, records: {} };

    const rec = await svc.upsert('pr:owner/repo#99', {
      overnightSpawnedAt: new Date('2026-01-30T00:00:00Z').toISOString(),
      overnightWorktreeId: 'work9'
    });

    expect(rec.overnightSpawnedAt).toBe('2026-01-30T00:00:00.000Z');
    expect(rec.overnightWorktreeId).toBe('work9');
  });

  test('upsert supports ticket fields and automation timestamps', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('pr:me/repo#99', {
      ticketProvider: 'TRELLO',
      ticketCardId: 'abc123',
      ticketBoardId: 'board1',
      ticketCardUrl: 'https://trello.com/c/abc123/99-something',
      ticketTitle: 'Fix launch button',
      prMergedAt: '2026-01-26T00:00:00Z',
      ticketMovedAt: '2026-01-26T00:00:10Z',
      ticketMoveTargetListId: 'list1'
    });

    expect(rec.ticketProvider).toBe('trello');
    expect(rec.ticketCardId).toBe('abc123');
    expect(rec.ticketBoardId).toBe('board1');
    expect(rec.ticketCardUrl).toBe('https://trello.com/c/abc123/99-something');
    expect(rec.ticketTitle).toBe('Fix launch button');
    expect(rec.prMergedAt).toBe('2026-01-26T00:00:00.000Z');
    expect(rec.ticketMovedAt).toBe('2026-01-26T00:00:10.000Z');
    expect(rec.ticketMoveTargetListId).toBe('list1');

    const rec2 = await svc.upsert('pr:me/repo#99', {
      ticketProvider: null,
      ticketCardId: '',
      ticketCardUrl: null,
      ticketTitle: null,
      ticketMovedAt: null,
      ticketMoveTargetListId: null
    });
    expect(rec2.ticketProvider).toBeUndefined();
    expect(rec2.ticketCardId).toBeUndefined();
    expect(rec2.ticketCardUrl).toBeUndefined();
    expect(rec2.ticketTitle).toBeUndefined();
    expect(rec2.ticketMovedAt).toBeUndefined();
    expect(rec2.ticketMoveTargetListId).toBeUndefined();
  });

  test('upsert supports claim fields', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:claim', { claimedBy: 'me', claimed: true });
    expect(rec.claimedBy).toBe('me');
    expect(typeof rec.claimedAt).toBe('string');

    const rec2 = await svc.upsert('task:claim', { claimed: false });
    expect(rec2.claimedBy).toBeUndefined();
    expect(rec2.claimedAt).toBeUndefined();
  });

  test('upsert supports assignment fields', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:assign', { assignedTo: 'alice' });
    expect(rec.assignedTo).toBe('alice');
    expect(typeof rec.assignedAt).toBe('string');

    const rec2 = await svc.upsert('task:assign', { assignedTo: null });
    expect(rec2.assignedTo).toBeUndefined();
    expect(rec2.assignedAt).toBeUndefined();
  });

  test('upsert supports review checklist fields', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('pr:me/repo#777', {
      reviewChecklist: {
        tests: { done: true, command: 'npm run test:unit' },
        manual: { done: false, steps: 'Open app and verify header' }
      }
    });

    expect(rec.reviewChecklist).toEqual({
      tests: { done: true, command: 'npm run test:unit' },
      manual: { steps: 'Open app and verify header' }
    });

    const rec2 = await svc.upsert('pr:me/repo#777', { reviewChecklist: null });
    expect(rec2.reviewChecklist).toBeUndefined();
  });

  test('task records can be promoted to repo-backed shared store', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const svc = new TaskRecordService({ filePath });
    const id = 'pr:me/repo#200';

    const rec = await svc.upsert(id, {
      tier: 2,
      changeRisk: 'low',
      recordVisibility: 'shared',
      recordRepoRoot: repoRoot
    });

    expect(rec.recordVisibility).toBe('shared');
    expect(rec.recordRepoRoot).toBe(repoRoot);
    expect(typeof rec.recordPath).toBe('string');

    const onDisk = path.join(repoRoot, rec.recordPath);
    expect(fs.existsSync(onDisk)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(onDisk, 'utf8'));
    expect(payload.v).toBe(1);
    expect(payload.record.tier).toBe(2);

    const resolved = svc.get(id);
    expect(resolved.tier).toBe(2);
    expect(resolved.recordVisibility).toBe('shared');

    const detached = await svc.upsert(id, { recordVisibility: 'private' });
    expect(detached.recordVisibility).toBeUndefined();
    expect(detached.tier).toBe(2);
  });

  test('task records can be promoted to repo-backed encrypted store', async () => {
    const prev = process.env.ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY;
    process.env.ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY = 'test-passphrase';
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
      const filePath = path.join(tmp, 'task-records.json');
      const repoRoot = path.join(tmp, 'repo');
      fs.mkdirSync(repoRoot, { recursive: true });

      const svc = new TaskRecordService({ filePath });
      const id = 'task:encrypted-store';

      const rec = await svc.upsert(id, {
        tier: 4,
        recordVisibility: 'encrypted',
        recordRepoRoot: repoRoot
      });

      expect(rec.recordVisibility).toBe('encrypted');
      expect(rec.recordRepoRoot).toBe(repoRoot);
      expect(typeof rec.recordPath).toBe('string');
      expect(rec.recordPath.endsWith('.enc.json')).toBe(true);

      const onDisk = path.join(repoRoot, rec.recordPath);
      expect(fs.existsSync(onDisk)).toBe(true);
      const payload = JSON.parse(fs.readFileSync(onDisk, 'utf8'));
      expect(payload.alg).toBe('aes-256-gcm');

      const resolved = svc.get(id);
      expect(resolved.tier).toBe(4);
      expect(resolved.recordVisibility).toBe('encrypted');
    } finally {
      process.env.ORCHESTRATOR_TASK_RECORDS_ENCRYPTION_KEY = prev;
    }
  });
});
