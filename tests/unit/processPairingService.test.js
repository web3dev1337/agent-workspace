const { ProcessPairingService } = require('../../server/processPairingService');

describe('ProcessPairingService', () => {
  test('ranks safe pairings above overlapping work in same project', async () => {
    const processTaskService = {
      listTasks: async () => ([
        { id: 'worktree:/repo/work1', kind: 'worktree', title: 'A', worktreePath: '/repo/work1' },
        { id: 'worktree:/repo/work2', kind: 'worktree', title: 'B', worktreePath: '/repo/work2' },
        { id: 'worktree:/other/work1', kind: 'worktree', title: 'C', worktreePath: '/other/work1' }
      ])
    };

    const taskRecordService = {
      get: (id) => {
        if (id === 'worktree:/repo/work1') return { tier: 2 };
        if (id === 'worktree:/repo/work2') return { tier: 3 };
        if (id === 'worktree:/other/work1') return { tier: 2 };
        return null;
      }
    };

    const projectMetadataService = {
      getForWorktree: async (p) => {
        if (String(p).includes('/repo/')) return { projectKey: 'repo' };
        if (String(p).includes('/other/')) return { projectKey: 'other' };
        return {};
      }
    };

    const worktreeConflictService = {
      getChangedFiles: async (p) => {
        if (String(p).includes('/repo/work1')) return ['src/a.js'];
        if (String(p).includes('/repo/work2')) return ['src/a.js']; // overlap
        if (String(p).includes('/other/work1')) return ['src/c.js'];
        return [];
      }
    };

    const svc = new ProcessPairingService({
      processTaskService,
      taskRecordService,
      worktreeConflictService,
      projectMetadataService
    });

    const res = await svc.getPairings({ mode: 'mine', tiers: [2, 3], limit: 10, refresh: true });
    expect(res.count).toBeGreaterThan(0);
    const pairs = res.pairs;

    const findPair = (a, b) => pairs.find(p =>
      (p.a.id === a && p.b.id === b) || (p.a.id === b && p.b.id === a)
    );

    const overlapPair = findPair('worktree:/repo/work1', 'worktree:/repo/work2');
    expect(overlapPair).toBeDefined();
    expect(overlapPair.reasons).toEqual(expect.arrayContaining(['same_project', 'file_overlap']));
    expect(overlapPair.overlapFiles).toEqual(['src/a.js']);

    const safePair = findPair('worktree:/repo/work1', 'worktree:/other/work1');
    expect(safePair).toBeDefined();
    expect(safePair.reasons).toEqual(expect.arrayContaining(['different_project']));
    expect(safePair.score).toBeGreaterThan(overlapPair.score);
  });
});

