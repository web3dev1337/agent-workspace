const fs = require('fs');
const os = require('os');
const path = require('path');

const { TaskRecordService, normalizeEvidence } = require('../../server/taskRecordService');

const makeService = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-evidence-'));
  return new TaskRecordService({ filePath: path.join(tmp, 'task-records.json') });
};

describe('task record evidence field', () => {
  test('upsert stores a full normalized evidence object', async () => {
    const svc = makeService();
    const rec = await svc.upsert('pr:me/repo#1', {
      evidence: {
        summary: 'Added spawn system',
        tests: { ran: true, command: 'npm test', passed: 47, failed: 0, output: 'ok', at: '2026-07-15T00:00:00Z' },
        appRun: { ran: true, method: 'puppeteer', url: 'http://localhost:5555', notes: 'no console errors' },
        media: [{ type: 'image', path: '.agent-evidence/shot.png', caption: 'spawn menu' }],
        data: [{ metric: 'dps', before: 120, after: 90, note: 'autoplay 3 runs' }],
        reviews: [{ role: 'Security', agentId: 'Codex', model: 'gpt-5.5', effort: 'HIGH', verdict: 'approved', findings: 2, fixed: 2 }],
        standards: ['CLAUDE.md', 'CLAUDE.md', 'docs/STANDARDS.md'],
        handoff: { notes: 'branch is rebased; only polish left' },
        diffStats: { files: 12, additions: 340, deletions: 80 }
      }
    });

    const ev = rec.evidence;
    expect(ev.schema).toBe(1);
    expect(typeof ev.updatedAt).toBe('string');
    expect(ev.tests).toEqual({ ran: true, command: 'npm test', passed: 47, failed: 0, output: 'ok', at: '2026-07-15T00:00:00.000Z' });
    expect(ev.appRun.method).toBe('puppeteer');
    expect(ev.media).toHaveLength(1);
    expect(ev.data[0]).toEqual({ metric: 'dps', before: 120, after: 90, note: 'autoplay 3 runs' });
    expect(ev.reviews[0]).toMatchObject({ role: 'security', agentId: 'codex', model: 'gpt-5.5', effort: 'high', verdict: 'approved', findings: 2, fixed: 2 });
    expect(ev.standards).toEqual(['CLAUDE.md', 'docs/STANDARDS.md']);
    expect(ev.diffStats).toEqual({ files: 12, additions: 340, deletions: 80 });
  });

  test('evidence: null clears the field', async () => {
    const svc = makeService();
    await svc.upsert('task:x', { evidence: { summary: 'something' } });
    const cleared = await svc.upsert('task:x', { evidence: null });
    expect(cleared.evidence).toBeUndefined();
  });

  test('garbage evidence entries are dropped, not stored', () => {
    const ev = normalizeEvidence({
      media: [{ type: 'image' }, 'nope', { type: 'weird', path: 'a.png' }],
      data: [{ note: 'no metric' }],
      reviews: [{}, { verdict: 'not-a-verdict', role: 'general' }],
      diffStats: { files: -3, additions: 'NaN' }
    });

    expect(ev.media).toEqual([{ type: 'other', path: 'a.png' }]);
    expect(ev.data).toBeUndefined();
    // review with invalid verdict keeps role but drops the bad verdict
    expect(ev.reviews).toEqual([{ role: 'general' }]);
    expect(ev.diffStats).toBeUndefined();
  });

  test('normalizeEvidence returns null for empty/invalid input', () => {
    expect(normalizeEvidence(null)).toBeNull();
    expect(normalizeEvidence('text')).toBeNull();
    expect(normalizeEvidence({})).toBeNull();
    expect(normalizeEvidence({ media: [], reviews: [] })).toBeNull();
  });

  test('long strings are capped', () => {
    const ev = normalizeEvidence({
      summary: 'x'.repeat(5000),
      tests: { output: 'y'.repeat(10000) },
      handoff: { notes: 'z'.repeat(10000) }
    });
    expect(ev.summary.length).toBe(2000);
    expect(ev.tests.output.length).toBe(4000);
    expect(ev.handoff.notes.length).toBe(4000);
  });
});
