const { parsePorcelainStatus, parseNumstat, normalizeRenamePath } = require('../../server/worktreeGitService');

describe('WorktreeGitService parsing', () => {
  test('parsePorcelainStatus parses status codes and renames', () => {
    const porcelain = [
      ' M src/app.js',
      'A  newfile.txt',
      'R  old.txt -> new.txt',
      '?? untracked.md'
    ].join('\n');

    const files = parsePorcelainStatus(porcelain);
    const byPath = new Map(files.map(f => [f.path, f]));
    expect(byPath.get('src/app.js')).toMatchObject({ indexStatus: ' ', worktreeStatus: 'M', isUntracked: false });
    expect(byPath.get('newfile.txt')).toMatchObject({ indexStatus: 'A', worktreeStatus: ' ', isUntracked: false });
    expect(byPath.get('new.txt')).toMatchObject({ indexStatus: 'R', oldPath: 'old.txt' });
    expect(byPath.get('untracked.md')).toMatchObject({ indexStatus: '?', worktreeStatus: '?', isUntracked: true });
  });

  test('normalizeRenamePath handles brace and arrow forms', () => {
    expect(normalizeRenamePath('old => new')).toBe('new');
    expect(normalizeRenamePath('old -> new')).toBe('new');
    expect(normalizeRenamePath('src/{old => new}.js')).toBe('src/new.js');
  });

  test('parseNumstat parses added/deleted and binary markers', () => {
    const out = [
      '10\t2\tsrc/app.js',
      '-\t-\tassets/image.png',
      '0\t0\tsrc/{old => new}.js'
    ].join('\n');

    const map = parseNumstat(out);
    expect(map.get('src/app.js')).toEqual({ added: 10, deleted: 2, binary: false });
    expect(map.get('assets/image.png')).toEqual({ added: null, deleted: null, binary: true });
    expect(map.get('src/new.js')).toEqual({ added: 0, deleted: 0, binary: false });
  });
});

