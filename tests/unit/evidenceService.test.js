const fs = require('fs');
const os = require('os');
const path = require('path');

const { EvidenceService, parseEvidenceBlocks, mergeEvidence } = require('../../server/evidenceService');
const { TaskRecordService } = require('../../server/taskRecordService');

const makeTaskRecords = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-evsvc-'));
  return new TaskRecordService({ filePath: path.join(tmp, 'task-records.json') });
};

const fence = (obj) => '```agent-evidence\n' + JSON.stringify(obj, null, 2) + '\n```';

describe('parseEvidenceBlocks', () => {
  test('extracts multiple fenced JSON blocks and skips malformed ones', () => {
    const text = [
      'Intro text',
      fence({ summary: 'first' }),
      '```agent-evidence\n{not json}\n```',
      'middle',
      fence({ tests: { ran: true, passed: 3 } })
    ].join('\n\n');

    const blocks = parseEvidenceBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].summary).toBe('first');
    expect(blocks[1].tests.passed).toBe(3);
  });

  test('strips server-only worktreePath from agent blocks', () => {
    const blocks = parseEvidenceBlocks(fence({ summary: 'sneaky', worktreePath: '/home/user/.ssh' }));
    expect(blocks[0].worktreePath).toBeUndefined();
  });

  test('returns empty for plain text and non-evidence fences', () => {
    expect(parseEvidenceBlocks('```json\n{"a":1}\n```')).toHaveLength(0);
    expect(parseEvidenceBlocks(undefined)).toHaveLength(0);
  });
});

describe('mergeEvidence', () => {
  test('later blocks win for scalar sections; arrays accumulate with de-dupe', () => {
    const merged = mergeEvidence(
      { summary: 'old', tests: { ran: true, passed: 1 }, reviews: [{ role: 'security', verdict: 'needs_fix', at: '2026-07-15T00:00:00Z' }], media: [{ type: 'image', path: 'a.png' }] },
      { summary: 'new', reviews: [{ role: 'security', verdict: 'needs_fix', at: '2026-07-15T00:00:00Z' }, { role: 'general', verdict: 'approved' }], media: [{ type: 'image', path: 'a.png' }, { type: 'image', path: 'b.png' }] }
    );

    expect(merged.summary).toBe('new');
    expect(merged.tests.passed).toBe(1);
    expect(merged.reviews).toHaveLength(2);
    expect(merged.media.map(m => m.path)).toEqual(['a.png', 'b.png']);
  });

  test('returns null when nothing merges', () => {
    expect(mergeEvidence(null, undefined, {})).toBeNull();
  });
});

describe('EvidenceService.refresh (PR source)', () => {
  test('collects evidence from PR body + comments and aggregates diff stats', async () => {
    const taskRecordService = makeTaskRecords();
    const pullRequestService = {
      getPullRequestDetailsByUrl: async () => ({
        pr: { headRefName: 'feature/x' },
        files: [
          { filename: 'a.js', additions: 10, deletions: 2 },
          { filename: 'b.js', additions: 5, deletions: 1 }
        ],
        conversation: {
          issueComments: [
            { body: 'LGTM overall\n' + fence({ reviews: [{ role: 'security', agentId: 'codex', verdict: 'approved', findings: 1, fixed: 1 }] }) }
          ],
          reviews: []
        }
      }),
      getPullRequest: async () => ({
        body: 'My PR\n' + fence({ summary: 'Adds spawn system', tests: { ran: true, command: 'npm test', passed: 12, failed: 0 } })
      })
    };

    const svc = new EvidenceService({ taskRecordService, pullRequestService });
    const result = await svc.refresh('pr:me/repo#5');

    expect(result.updated).toBe(true);
    expect(result.evidence.summary).toBe('Adds spawn system');
    expect(result.evidence.tests.passed).toBe(12);
    expect(result.evidence.reviews[0]).toMatchObject({ role: 'security', agentId: 'codex', verdict: 'approved' });
    expect(result.evidence.diffStats).toEqual({ files: 2, additions: 15, deletions: 3 });

    const persisted = taskRecordService.get('pr:me/repo#5');
    expect(persisted.evidence.summary).toBe('Adds spawn system');
  });

  test('worktree file evidence merges for worktree tasks', async () => {
    const taskRecordService = makeTaskRecords();
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-worktree-'));
    fs.writeFileSync(path.join(worktree, '.agent-evidence.json'), JSON.stringify({
      summary: 'local run',
      appRun: { ran: true, method: 'server-smoke' },
      media: [{ type: 'image', path: '.agent-evidence/shot.png' }]
    }));

    const svc = new EvidenceService({ taskRecordService });
    const result = await svc.refresh(`worktree:${worktree}`);

    expect(result.updated).toBe(true);
    expect(result.evidence.appRun.method).toBe('server-smoke');
    expect(result.evidence.worktreePath).toBe(worktree);
  });
});

describe('EvidenceService.resolveMediaPath', () => {
  const setup = async () => {
    const taskRecordService = makeTaskRecords();
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-media-'));
    fs.mkdirSync(path.join(worktree, '.agent-evidence'), { recursive: true });
    fs.writeFileSync(path.join(worktree, '.agent-evidence', 'shot.png'), 'fake-png');
    await taskRecordService.upsert('task:media', {
      evidence: {
        media: [
          { type: 'image', path: '.agent-evidence/shot.png' },
          { type: 'other', path: '../../etc/passwd' },
          { type: 'other', path: '.agent-evidence/script.sh' }
        ],
        worktreePath: worktree
      }
    });
    return { svc: new EvidenceService({ taskRecordService }), worktree };
  };

  test('resolves a valid media file inside the worktree', async () => {
    const { svc, worktree } = await setup();
    const result = svc.resolveMediaPath('task:media', 0);
    expect(result.path).toBe(path.join(worktree, '.agent-evidence', 'shot.png'));
  });

  test('rejects traversal outside the worktree', async () => {
    const { svc } = await setup();
    const result = svc.resolveMediaPath('task:media', 1);
    expect(result.status).toBe(403);
  });

  test('rejects disallowed extensions and bad indexes', async () => {
    const { svc } = await setup();
    expect(svc.resolveMediaPath('task:media', 2).status).toBe(415);
    expect(svc.resolveMediaPath('task:media', 99).status).toBe(404);
  });
});
