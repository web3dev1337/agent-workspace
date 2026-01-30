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
      fixerSpawnedAt: '2026-01-25T00:00:12Z',
      fixerWorktreeId: 'work10',
      recheckSpawnedAt: '2026-01-25T00:00:13Z',
      recheckWorktreeId: 'work11'
    });

    expect(rec.reviewStartedAt).toBe('2026-01-25T00:00:00.000Z');
    expect(rec.reviewEndedAt).toBe('2026-01-25T00:01:00.000Z');
    expect(rec.promptSentAt).toBe('2026-01-25T00:00:10.000Z');
    expect(rec.promptChars).toBe(123);
    expect(rec.reviewerSpawnedAt).toBe('2026-01-25T00:00:11.000Z');
    expect(rec.reviewerWorktreeId).toBe('work9');
    expect(rec.fixerSpawnedAt).toBe('2026-01-25T00:00:12.000Z');
    expect(rec.fixerWorktreeId).toBe('work10');
    expect(rec.recheckSpawnedAt).toBe('2026-01-25T00:00:13.000Z');
    expect(rec.recheckWorktreeId).toBe('work11');
  });

  test('upsert supports prompt repo location fields', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-task-records-'));
    const filePath = path.join(tmp, 'task-records.json');
    const svc = new TaskRecordService({ filePath });

    const rec = await svc.upsert('task:prompt', {
      promptRef: 'task:prompt',
      promptVisibility: 'shared',
      promptRepoRoot: '/home/<user>/GitHub/games/hytopia/mock-repo',
      promptPath: '.orchestrator/prompts/task-prompt.md'
    });

    expect(rec.promptVisibility).toBe('shared');
    expect(rec.promptRepoRoot).toBe('/home/<user>/GitHub/games/hytopia/mock-repo');
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
});
