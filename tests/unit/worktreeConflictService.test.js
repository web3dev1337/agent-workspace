const { WorktreeConflictService, parsePorcelainFiles } = require('../../server/worktreeConflictService');

describe('WorktreeConflictService', () => {
  test('parsePorcelainFiles extracts paths and handles renames', () => {
    const porcelain = [
      ' M src/app.js',
      'A  newfile.txt',
      'R  old.txt -> new.txt',
      '?? untracked.md'
    ].join('\n');

    const files = parsePorcelainFiles(porcelain);
    expect(files.sort()).toEqual(['new.txt', 'newfile.txt', 'src/app.js', 'untracked.md'].sort());
  });

  test('analyze groups by project and detects overlaps', async () => {
    const projectMetadataService = {
      getForWorktree: async (p) => ({ projectKey: 'games/hytopia/zoo-game', projectRoot: '/x', baseImpactRisk: 'medium' })
    };

    const worktreeMetadataService = {
      getGitStatus: async (p) => ({ branch: p.includes('w1') ? 'feat/a' : 'feat/b' }),
      getPRStatus: async (p) => ({ hasPR: false })
    };

    const svc = new WorktreeConflictService({ projectMetadataService, worktreeMetadataService });
    svc.getChangedFiles = async (p) => (p.includes('w1') ? ['src/a.js', 'src/shared.js'] : ['src/shared.js', 'src/b.js']);

    const result = await svc.analyze({ paths: ['/tmp/w1', '/tmp/w2'], refresh: true });
    expect(result.count).toBe(1);
    expect(result.conflicts[0].type).toBe('file-overlap');
    expect(result.conflicts[0].overlapFiles).toContain('src/shared.js');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].baseImpactRisk).toBe('medium');
  });
});

