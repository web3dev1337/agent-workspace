const fs = require('fs');
const path = require('path');
const os = require('os');

function loadPathUtils(homeDir = null) {
  jest.resetModules();
  jest.unmock('os');
  if (homeDir) {
    jest.doMock('os', () => ({
      ...jest.requireActual('os'),
      homedir: () => homeDir
    }));
  }
  return require('../../server/utils/pathUtils');
}

describe('pathUtils', () => {
  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_DIR;
    delete process.env.AGENT_WORKSPACE_PROJECTS_DIR;
    jest.resetModules();
    jest.unmock('os');
  });

  test('normalizePathSlashes converts Windows separators', () => {
    const { normalizePathSlashes } = loadPathUtils();
    expect(normalizePathSlashes('C:\\GitHub\\repo\\work1')).toBe('C:/GitHub/repo/work1');
  });

  test('splitPathSegments handles Windows and POSIX paths', () => {
    const { splitPathSegments } = loadPathUtils();
    expect(splitPathSegments('C:\\GitHub\\repo\\work1')).toEqual(['C:', 'GitHub', 'repo', 'work1']);
    expect(splitPathSegments('/home/user/repo/work2')).toEqual(['home', 'user', 'repo', 'work2']);
  });

  test('getPathBasename trims trailing separators safely', () => {
    const { getPathBasename } = loadPathUtils();
    expect(getPathBasename('C:\\GitHub\\repo\\work1\\')).toBe('work1');
    expect(getPathBasename('/tmp/repo/master/')).toBe('master');
  });

  test('getTrailingPathLabel returns the last path segments', () => {
    const { getTrailingPathLabel } = loadPathUtils();
    expect(getTrailingPathLabel('C:\\GitHub\\repo\\work1')).toBe('repo/work1');
    expect(getTrailingPathLabel('/tmp/repo/work2', 1)).toBe('work2');
  });

  test('bootstrapProjectsRoot falls back to legacy GitHub when the new projects root is empty', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'games'), { recursive: true });

    const {
      bootstrapProjectsRoot,
      getProjectsRoot,
      getLegacyProjectsRoot
    } = loadPathUtils(tmpHome);

    const result = bootstrapProjectsRoot();

    expect(result.usingLegacyProjectsRoot).toBe(true);
    expect(result.projectsDir).toBe(getLegacyProjectsRoot());
    expect(getProjectsRoot()).toBe(getLegacyProjectsRoot());
    expect(process.env.AGENT_WORKSPACE_PROJECTS_DIR).toBe(getLegacyProjectsRoot());
  });

  test('bootstrapProjectsRoot keeps the new projects root when it is already populated', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'games'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.agent-workspace', 'projects', 'tools'), { recursive: true });

    const {
      bootstrapProjectsRoot,
      getProjectsRoot,
      getLegacyProjectsRoot
    } = loadPathUtils(tmpHome);

    const result = bootstrapProjectsRoot();

    expect(result.usingLegacyProjectsRoot).toBe(false);
    expect(getProjectsRoot()).toBe(path.join(tmpHome, '.agent-workspace', 'projects'));
    expect(getProjectsRoot()).not.toBe(getLegacyProjectsRoot());
    expect(process.env.AGENT_WORKSPACE_PROJECTS_DIR).toBeUndefined();
  });
});
