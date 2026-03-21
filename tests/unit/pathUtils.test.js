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

  test('bootstrapProjectsRoot falls back to legacy GitHub when repos use worktree layout', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    // Create repos with worktree layout (master/ with .git)
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'repo-a', 'master', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'repo-b', 'master', '.git'), { recursive: true });

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

  test('bootstrapProjectsRoot skips legacy GitHub when repos are all flat clones', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    // Flat clones — no master/ subdirectory, just .git at root
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'repo-a', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'repo-b', '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, 'GitHub', 'repo-c', '.git'), { recursive: true });

    const {
      bootstrapProjectsRoot,
      getProjectsRoot,
      getLegacyProjectsRoot
    } = loadPathUtils(tmpHome);

    const result = bootstrapProjectsRoot();

    expect(result.usingLegacyProjectsRoot).toBe(false);
    expect(result.legacySkipReason).toBe('no-worktree-layout');
    expect(getProjectsRoot()).not.toBe(getLegacyProjectsRoot());
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

  test('hasWorktreeLayout detects master/ with .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-layout-'));
    fs.mkdirSync(path.join(tmpDir, 'master', '.git'), { recursive: true });

    const { hasWorktreeLayout } = loadPathUtils();
    expect(hasWorktreeLayout(tmpDir)).toBe(true);
  });

  test('hasWorktreeLayout detects main/ with .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-layout-'));
    fs.mkdirSync(path.join(tmpDir, 'main', '.git'), { recursive: true });

    const { hasWorktreeLayout } = loadPathUtils();
    expect(hasWorktreeLayout(tmpDir)).toBe(true);
  });

  test('hasWorktreeLayout returns false for flat clones', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-layout-'));
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

    const { hasWorktreeLayout } = loadPathUtils();
    expect(hasWorktreeLayout(tmpDir)).toBe(false);
  });

  test('countWorktreeLayoutRepos counts repos at multiple nesting depths', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-count-'));
    // Depth 1: worktree layout
    fs.mkdirSync(path.join(tmpDir, 'repo-a', 'master', '.git'), { recursive: true });
    // Depth 2 (nested category): worktree layout
    fs.mkdirSync(path.join(tmpDir, 'games', 'zoo-game', 'master', '.git'), { recursive: true });
    // Depth 2: flat clone
    fs.mkdirSync(path.join(tmpDir, 'games', 'flat-game', '.git'), { recursive: true });
    // Depth 4 (deep nesting): worktree layout
    fs.mkdirSync(path.join(tmpDir, 'games', 'hytopia', 'games', 'hyfire', 'master', '.git'), { recursive: true });

    const { countWorktreeLayoutRepos } = loadPathUtils();
    const result = countWorktreeLayoutRepos(tmpDir);
    expect(result.total).toBe(4);
    expect(result.worktree).toBe(3);
  });

  test('getAgentWorkspaceDir falls back to legacy data when legacy has more workspaces', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    fs.mkdirSync(path.join(tmpHome, '.agent-workspace', 'workspaces'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.orchestrator', 'workspaces'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-1.json'), '{}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'workspaces', 'workspace-1.json'), '{}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'workspaces', 'workspace-2.json'), '{}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'quick-links.json'), '{}');

    const {
      getAgentWorkspaceDir,
      getLegacyCompatibilityState
    } = loadPathUtils(tmpHome);

    expect(getAgentWorkspaceDir()).toBe(path.join(tmpHome, '.orchestrator'));
    expect(getLegacyCompatibilityState()).toMatchObject({
      shouldUseLegacyDir: true,
      reason: 'legacy-has-more-workspaces',
      oldWorkspaceCount: 2,
      newWorkspaceCount: 1
    });
  });

  test('getAgentWorkspaceDir keeps the new data dir when it is richer than legacy', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    fs.mkdirSync(path.join(tmpHome, '.agent-workspace', 'workspaces'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.orchestrator', 'workspaces'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-1.json'), '{}');
    fs.writeFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-2.json'), '{}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'workspaces', 'workspace-1.json'), '{}');

    const {
      getAgentWorkspaceDir,
      getLegacyCompatibilityState
    } = loadPathUtils(tmpHome);

    expect(getAgentWorkspaceDir()).toBe(path.join(tmpHome, '.agent-workspace'));
    expect(getLegacyCompatibilityState()).toMatchObject({
      shouldUseLegacyDir: false,
      reason: 'prefer-new',
      oldWorkspaceCount: 1,
      newWorkspaceCount: 2
    });
  });

  test('mergeLegacyDataDir copies legacy data into the new directory and backs up conflicts', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-home-'));
    fs.mkdirSync(path.join(tmpHome, '.agent-workspace', 'workspaces'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.orchestrator', 'workspaces'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-1.json'), '{"name":"new"}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'workspaces', 'workspace-1.json'), '{"name":"old"}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'workspaces', 'workspace-2.json'), '{"name":"legacy-only"}');
    fs.writeFileSync(path.join(tmpHome, '.orchestrator', 'quick-links.json'), '{"links":[1]}');

    const {
      mergeLegacyDataDir,
      getAgentWorkspaceDir,
      getLegacyCompatibilityState
    } = loadPathUtils(tmpHome);

    const result = mergeLegacyDataDir();

    expect(result.merged).toBe(true);
    expect(result.overwritten).toContain(path.join('workspaces', 'workspace-1.json'));
    expect(result.copied).toContain(path.join('workspaces', 'workspace-2.json'));
    expect(result.copied).toContain('quick-links.json');
    expect(fs.readFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-1.json'), 'utf8')).toBe('{"name":"old"}');
    expect(fs.readFileSync(path.join(tmpHome, '.agent-workspace', 'workspaces', 'workspace-2.json'), 'utf8')).toBe('{"name":"legacy-only"}');
    expect(fs.readFileSync(path.join(tmpHome, '.agent-workspace', 'quick-links.json'), 'utf8')).toBe('{"links":[1]}');

    const backupRoot = path.join(tmpHome, '.agent-workspace', 'migration-backups');
    const backupDirs = fs.readdirSync(backupRoot);
    expect(backupDirs.length).toBe(1);
    expect(
      fs.readFileSync(
        path.join(backupRoot, backupDirs[0], 'workspaces', 'workspace-1.json'),
        'utf8'
      )
    ).toBe('{"name":"new"}');

    expect(getLegacyCompatibilityState()).toMatchObject({
      shouldUseLegacyDir: false
    });
    expect(getAgentWorkspaceDir()).toBe(path.join(tmpHome, '.agent-workspace'));
  });
});
