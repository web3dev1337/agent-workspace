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

  test('upsert supports telemetry timestamps and prompt chars', async () => {
    const service = new TaskRecordService({ filePath: '/tmp/test-task-records-telemetry.json' });
    const rec = await service.upsert('task:telemetry', {
      reviewStartedAt: '2026-01-25T00:00:00Z',
      reviewEndedAt: '2026-01-25T00:01:00Z',
      promptSentAt: '2026-01-25T00:00:10Z',
      promptChars: 123
    });

    expect(rec.reviewStartedAt).toBe('2026-01-25T00:00:00.000Z');
    expect(rec.reviewEndedAt).toBe('2026-01-25T00:01:00.000Z');
    expect(rec.promptSentAt).toBe('2026-01-25T00:00:10.000Z');
    expect(rec.promptChars).toBe(123);
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
});
