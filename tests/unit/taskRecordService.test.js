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
});
