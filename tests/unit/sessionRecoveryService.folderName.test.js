/**
 * Unit tests for SessionRecoveryService.claudeProjectFolderName and the
 * newest-non-empty-conversation fallback in getLatestConversation().
 *
 * claudeProjectFolderName must mirror Claude Code's own sanitization:
 * every character outside [a-zA-Z0-9-] becomes '-'.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { SessionRecoveryService } = require('../../server/sessionRecoveryService');

describe('SessionRecoveryService.claudeProjectFolderName', () => {
  let svc;

  beforeEach(() => {
    svc = new SessionRecoveryService();
  });

  it('sanitizes a Linux path containing dots (hidden directory)', () => {
    expect(svc.claudeProjectFolderName('/home/ab/.agent-workspace/work1'))
      .toBe('-home-ab--agent-workspace-work1');
  });

  it('sanitizes a plain Linux path', () => {
    expect(svc.claudeProjectFolderName('/home/ab/GitHub/tools'))
      .toBe('-home-ab-GitHub-tools');
  });

  it('sanitizes a Windows path with drive letter and hidden directory', () => {
    expect(svc.claudeProjectFolderName('C:\\Users\\x\\.agent-workspace\\repo'))
      .toBe('C--Users-x--agent-workspace-repo');
  });

  it('dashes underscores and spaces', () => {
    expect(svc.claudeProjectFolderName('/home/ab/my_repo dir'))
      .toBe('-home-ab-my-repo-dir');
  });

  it('returns an empty string for empty/undefined input', () => {
    expect(svc.claudeProjectFolderName('')).toBe('');
    expect(svc.claudeProjectFolderName(undefined)).toBe('');
  });
});

describe('SessionRecoveryService.getLatestConversation newest-non-empty fallback', () => {
  let tmpHome;
  let originalHome;
  let SessionRecoveryServiceFresh;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'src-fixture-'));
    process.env.HOME = tmpHome;

    // sessionRecoveryService.js reads HOME_DIR at module load time, so it
    // must be required fresh after HOME is overridden.
    jest.resetModules();
    ({ SessionRecoveryService: SessionRecoveryServiceFresh } = require('../../server/sessionRecoveryService'));
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    jest.resetModules();
  });

  it('returns the newest non-empty .jsonl id and ignores subdirectories', () => {
    const worktreePath = path.join(tmpHome, 'GitHub', 'repo', 'work1');
    const svc = new SessionRecoveryServiceFresh();
    const folderName = svc.claudeProjectFolderName(worktreePath);
    const projectsDir = path.join(tmpHome, '.claude', 'projects', folderName);
    fs.mkdirSync(projectsDir, { recursive: true });

    const now = Date.now();

    const older = path.join(projectsDir, 'older-convo.jsonl');
    fs.writeFileSync(older, '{"line":"one"}\n');
    fs.utimesSync(older, new Date(now - 60000), new Date(now - 60000));

    const empty = path.join(projectsDir, 'empty-convo.jsonl');
    fs.writeFileSync(empty, '');
    fs.utimesSync(empty, new Date(now + 60000), new Date(now + 60000));

    const newest = path.join(projectsDir, 'newest-convo.jsonl');
    fs.writeFileSync(newest, '{"line":"two"}\n');
    fs.utimesSync(newest, new Date(now), new Date(now));

    // A subdirectory that happens to end in .jsonl-looking name should not matter;
    // ensure a real subdirectory present in the folder is ignored outright.
    fs.mkdirSync(path.join(projectsDir, 'subdir'), { recursive: true });

    const result = svc.getLatestConversation(worktreePath);

    expect(result).toBeTruthy();
    expect(result.conversationId).toBe('newest-convo');
    expect(result.actualCwd).toBe(worktreePath);
  });
});
