const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { SessionManager } = require('../../server/sessionManager');

describe('SessionManager.findHeadFile', () => {
  jest.setTimeout(30000);

  let tempDir;

  function run(cmd, cwd) {
    execSync(cmd, { cwd, stdio: 'ignore' });
  }

  function initRepo(repoPath) {
    fs.mkdirSync(repoPath, { recursive: true });
    run('git init', repoPath);
    run('git config user.email "test@example.com"', repoPath);
    run('git config user.name "Test"', repoPath);
    fs.writeFileSync(path.join(repoPath, 'README.md'), 'test\n');
    run('git add -A', repoPath);
    run('git commit -m "init"', repoPath);
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-sessionManager-findHeadFile-'));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('finds HEAD from a subdirectory (resolves relative git-dir)', () => {
    const repoPath = path.join(tempDir, 'repo');
    initRepo(repoPath);

    const subdir = path.join(repoPath, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });

    const sm = new SessionManager({ emit() {} }, null);
    const headPath = sm.findHeadFile(subdir);
    const canonicalHead = fs.realpathSync.native ? fs.realpathSync.native(headPath) : fs.realpathSync(headPath);
    const canonicalExpected = fs.realpathSync.native
      ? fs.realpathSync.native(path.join(repoPath, '.git', 'HEAD'))
      : fs.realpathSync(path.join(repoPath, '.git', 'HEAD'));

    expect(canonicalHead).toBe(canonicalExpected);
    expect(fs.existsSync(headPath)).toBe(true);
  });

  it('finds HEAD for a git worktree (via .git file gitdir)', () => {
    const repoPath = path.join(tempDir, 'repo');
    initRepo(repoPath);

    const worktreePath = path.join(tempDir, 'wt1');
    run(`git worktree add -b wt-branch \"${worktreePath}\"`, repoPath);

    const gitFilePath = path.join(worktreePath, '.git');
    const gitFile = fs.readFileSync(gitFilePath, 'utf8').trim();
    const gitDirLine = gitFile.split(/\r?\n/).find(l => l.toLowerCase().startsWith('gitdir:'));
    expect(gitDirLine).toBeTruthy();
    let gitDir = gitDirLine.replace(/^gitdir:\s*/i, '').trim();
    if (!path.isAbsolute(gitDir)) {
      gitDir = path.resolve(worktreePath, gitDir);
    }
    const expectedHead = path.join(gitDir, 'HEAD');

    const sm = new SessionManager({ emit() {} }, null);
    const headPath = sm.findHeadFile(worktreePath);
    const canonicalHead = fs.realpathSync.native ? fs.realpathSync.native(headPath) : fs.realpathSync(headPath);
    const canonicalExpected = fs.realpathSync.native
      ? fs.realpathSync.native(expectedHead)
      : fs.realpathSync(expectedHead);

    expect(canonicalHead).toBe(canonicalExpected);
    expect(fs.existsSync(headPath)).toBe(true);
  });
});
