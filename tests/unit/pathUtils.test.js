const {
  getPathBasename,
  getTrailingPathLabel,
  normalizePathSlashes,
  splitPathSegments
} = require('../../server/utils/pathUtils');

describe('pathUtils', () => {
  test('normalizePathSlashes converts Windows separators', () => {
    expect(normalizePathSlashes('C:\\GitHub\\repo\\work1')).toBe('C:/GitHub/repo/work1');
  });

  test('splitPathSegments handles Windows and POSIX paths', () => {
    expect(splitPathSegments('C:\\GitHub\\repo\\work1')).toEqual(['C:', 'GitHub', 'repo', 'work1']);
    expect(splitPathSegments('/home/user/repo/work2')).toEqual(['home', 'user', 'repo', 'work2']);
  });

  test('getPathBasename trims trailing separators safely', () => {
    expect(getPathBasename('C:\\GitHub\\repo\\work1\\')).toBe('work1');
    expect(getPathBasename('/tmp/repo/master/')).toBe('master');
  });

  test('getTrailingPathLabel returns the last path segments', () => {
    expect(getTrailingPathLabel('C:\\GitHub\\repo\\work1')).toBe('repo/work1');
    expect(getTrailingPathLabel('/tmp/repo/work2', 1)).toBe('work2');
  });
});
